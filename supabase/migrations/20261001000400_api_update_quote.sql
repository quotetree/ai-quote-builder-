-- Updates a quote, replaces its items and rewrites its linked spreadsheet for an organization API key in one transaction,
-- and records the write in api_key_audit. Callable by service_role only.

CREATE OR REPLACE FUNCTION public.api_update_quote(
  p_organization_id UUID, p_key_id UUID, p_quote_id UUID, p_fields JSONB, p_items JSONB,
  p_subtotal NUMERIC, p_sheet_sections JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_fields JSONB := coalesce(p_fields, '{}'::jsonb);
  v_quote quotes%ROWTYPE;
BEGIN
  -- This UPDATE takes the quote row lock, and the spreadsheet editor saves through save_spreadsheet_quote, which takes
  -- the same lock first, so the two saves run one after the other. is_editing marks an open chat edit session: it is
  -- set before that session reads its snapshot and cleared only after its last write, so the update is refused then.
  -- Stored charges and markups are kept and re-added to the new subtotal in the same statement.
  -- A NULL version_number would make the snapshot trigger's comparison NULL and skip history, hence the coalesce.
  UPDATE quotes SET
    quote_name = CASE WHEN v_fields ? 'quote_name' THEN v_fields->>'quote_name' ELSE quote_name END,
    status = CASE WHEN v_fields ? 'status' THEN v_fields->>'status' ELSE status END,
    expiration_date = CASE WHEN v_fields ? 'expiration_date' THEN (v_fields->>'expiration_date')::date ELSE expiration_date END,
    subtotal = CASE WHEN p_items IS NOT NULL THEN p_subtotal ELSE subtotal END,
    total_price = CASE WHEN p_items IS NOT NULL THEN p_subtotal
      + coalesce((SELECT sum((c->>'calculated_amount')::numeric) FROM jsonb_array_elements(coalesce(charges, '[]'::jsonb)) c), 0)
      + coalesce((SELECT sum((m->>'calculated_amount')::numeric) FROM jsonb_array_elements(coalesce(baked_markups, '[]'::jsonb)) m), 0)
      ELSE total_price END,
    version_number = CASE WHEN p_items IS NOT NULL THEN coalesce(version_number, 1) + 1 ELSE version_number END
  WHERE id = p_quote_id AND organization_id = p_organization_id AND NOT coalesce(is_editing, false)
  RETURNING * INTO v_quote;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM quotes WHERE id = p_quote_id AND organization_id = p_organization_id) THEN
      PERFORM api_key_audit_log(p_key_id, p_organization_id, 'update', p_quote_id, 'locked');
      RETURN jsonb_build_object('status', 'locked');
    END IF;
    PERFORM api_key_audit_log(p_key_id, p_organization_id, 'update', p_quote_id, 'not_found');
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_items IS NOT NULL THEN
    DELETE FROM quote_items WHERE quote_id = v_quote.id;

    INSERT INTO quote_items (quote_id, product_id, product_number, product_name, description,
      quantity, unit_price, discount_percent, line_total, sort_order)
    SELECT v_quote.id, NULL, i.product_number, i.product_name, i.description,
      i.quantity, i.unit_price, coalesce(i.discount_percent, 0), i.line_total, i.sort_order
    FROM jsonb_to_recordset(p_items) AS i(product_number TEXT, product_name TEXT, description TEXT,
      quantity NUMERIC, unit_price NUMERIC, discount_percent NUMERIC, line_total NUMERIC, sort_order INTEGER);
  END IF;

  -- A linked sheet is rewritten only when its project is in the key's organization; otherwise it is left alone
  IF v_quote.spreadsheet_id IS NOT NULL AND (p_items IS NOT NULL OR v_fields ? 'quote_name') THEN
    UPDATE project_spreadsheets s SET
      sections = CASE WHEN p_items IS NOT NULL THEN coalesce(p_sheet_sections, s.sections) ELSE s.sections END,
      subtotal = CASE WHEN p_items IS NOT NULL THEN v_quote.subtotal ELSE s.subtotal END,
      total = CASE WHEN p_items IS NOT NULL THEN v_quote.total_price ELSE s.total END,
      title = CASE WHEN v_fields ? 'quote_name' THEN v_quote.quote_name ELSE s.title END
    FROM projects p
    WHERE s.id = v_quote.spreadsheet_id AND p.id = s.project_id AND p.organization_id = p_organization_id;
  END IF;

  UPDATE projects SET updated_at = now() WHERE id = v_quote.project_id AND organization_id = p_organization_id;

  PERFORM api_key_audit_log(p_key_id, p_organization_id, 'update', p_quote_id, 'ok');

  RETURN jsonb_build_object(
    'status', 'ok',
    'quote', to_jsonb(v_quote),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb)
              FROM quote_items qi WHERE qi.quote_id = v_quote.id)
  );
EXCEPTION
  -- The block's changes are rolled back, so a total that does not fit changes nothing. The audit row is
  -- written after that rollback, so it is kept.
  WHEN numeric_value_out_of_range THEN
    PERFORM api_key_audit_log(p_key_id, p_organization_id, 'update', p_quote_id, 'too_large');
    RETURN jsonb_build_object('status', 'too_large');
END;
$$;

-- REVOKE FROM PUBLIC alone leaves Supabase's default grants to anon and authenticated in place
REVOKE ALL ON FUNCTION public.api_update_quote(UUID, UUID, UUID, JSONB, JSONB, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_update_quote(UUID, UUID, UUID, JSONB, JSONB, NUMERIC, JSONB)
  TO service_role;
