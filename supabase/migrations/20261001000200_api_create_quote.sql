-- Creates a quote and its items for an organization API key in one transaction, and records the write
-- in api_key_audit. Callable by service_role only.

CREATE OR REPLACE FUNCTION public.api_create_quote(
  p_organization_id UUID, p_key_id UUID, p_project_id UUID, p_quote_name TEXT, p_status TEXT,
  p_expiration_date DATE, p_scope_of_work TEXT, p_items JSONB, p_subtotal NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_next INTEGER;
  v_quote quotes%ROWTYPE;
BEGIN
  -- The project row lock serializes creates per project, so two cannot take the same number.
  -- It is already the strength the updated_at bump below needs, so no create waits to upgrade a
  -- lock another create shares. A quote insert's foreign key check takes only FOR KEY SHARE on the
  -- project, which this lock does not block.
  -- A project outside the key's organization is never locked, numbered or touched.
  PERFORM 1 FROM projects WHERE id = p_project_id AND organization_id = p_organization_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    PERFORM api_key_audit_log(p_key_id, p_organization_id, 'create', NULL, 'not_found');
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT owner_id INTO v_owner FROM organizations WHERE id = p_organization_id;

  SELECT coalesce(max((substring(quote_number from 'Q-(\d+)'))::int), 0) + 1 INTO v_next
    FROM quotes WHERE project_id = p_project_id;

  -- p_scope_of_work is the marker that reopens the quote in the spreadsheet editor (SPREADSHEET_QUOTE_SCOPE)
  INSERT INTO quotes (organization_id, project_id, user_id, author_id, quote_number, quote_name, status,
    scope_of_work, expiration_date, subtotal, tax_amount, total_price, charges, baked_markups)
  VALUES (p_organization_id, p_project_id, v_owner, NULL, 'Q-' || lpad(v_next::text, 4, '0'), p_quote_name,
    p_status, p_scope_of_work, p_expiration_date, p_subtotal, 0, p_subtotal, '[]'::jsonb, '[]'::jsonb)
  RETURNING * INTO v_quote;

  INSERT INTO quote_items (quote_id, product_id, product_number, product_name, description,
    quantity, unit_price, discount_percent, line_total, sort_order)
  SELECT v_quote.id, NULL, i.product_number, i.product_name, i.description,
    i.quantity, i.unit_price, coalesce(i.discount_percent, 0), i.line_total, i.sort_order
  FROM jsonb_to_recordset(p_items) AS i(product_number TEXT, product_name TEXT, description TEXT,
    quantity NUMERIC, unit_price NUMERIC, discount_percent NUMERIC, line_total NUMERIC, sort_order INTEGER);

  UPDATE projects SET updated_at = now() WHERE id = p_project_id AND organization_id = p_organization_id;

  PERFORM api_key_audit_log(p_key_id, p_organization_id, 'create', v_quote.id, 'ok');

  RETURN jsonb_build_object(
    'status', 'ok',
    'quote', to_jsonb(v_quote),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb)
              FROM quote_items qi WHERE qi.quote_id = v_quote.id)
  );
END;
$$;

-- REVOKE FROM PUBLIC alone leaves Supabase's default grants to anon and authenticated in place
REVOKE ALL ON FUNCTION public.api_create_quote(UUID, UUID, UUID, TEXT, TEXT, DATE, TEXT, JSONB, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_quote(UUID, UUID, UUID, TEXT, TEXT, DATE, TEXT, JSONB, NUMERIC)
  TO service_role;
