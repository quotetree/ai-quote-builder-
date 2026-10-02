-- Creates a quote and its items for an organization API key in one transaction. Callable by service_role only.

CREATE OR REPLACE FUNCTION public.api_create_quote(
  p_organization_id UUID, p_project_id UUID, p_quote_name TEXT, p_status TEXT,
  p_expiration_date DATE, p_items JSONB, p_subtotal NUMERIC
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
  -- A project outside the key's organization is never locked, numbered or touched
  PERFORM 1 FROM projects WHERE id = p_project_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT owner_id INTO v_owner FROM organizations WHERE id = p_organization_id;

  -- Serialize numbering per project so two creates cannot take the same number
  PERFORM pg_advisory_xact_lock(hashtext(p_project_id::text));
  SELECT coalesce(max((substring(quote_number from 'Q-(\d+)'))::int), 0) + 1 INTO v_next
    FROM quotes WHERE project_id = p_project_id;

  INSERT INTO quotes (organization_id, project_id, user_id, author_id, quote_number, quote_name, status,
    scope_of_work, expiration_date, subtotal, tax_amount, total_price, charges, baked_markups)
  VALUES (p_organization_id, p_project_id, v_owner, NULL, 'Q-' || lpad(v_next::text, 4, '0'), p_quote_name,
    p_status, 'Generated from spreadsheet', p_expiration_date, p_subtotal, 0, p_subtotal, '[]'::jsonb, '[]'::jsonb)
  RETURNING * INTO v_quote;

  INSERT INTO quote_items (quote_id, product_id, product_number, product_name, description,
    quantity, unit_price, discount_percent, line_total, sort_order)
  SELECT v_quote.id, NULL, i.product_number, i.product_name, i.description,
    i.quantity, i.unit_price, coalesce(i.discount_percent, 0), i.line_total, i.sort_order
  FROM jsonb_to_recordset(p_items) AS i(product_number TEXT, product_name TEXT, description TEXT,
    quantity NUMERIC, unit_price NUMERIC, discount_percent NUMERIC, line_total NUMERIC, sort_order INTEGER);

  UPDATE projects SET updated_at = now() WHERE id = p_project_id AND organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'quote', to_jsonb(v_quote),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb)
              FROM quote_items qi WHERE qi.quote_id = v_quote.id)
  );
END;
$$;

-- REVOKE FROM PUBLIC alone leaves Supabase's default grants to anon and authenticated in place
REVOKE ALL ON FUNCTION public.api_create_quote(UUID, UUID, TEXT, TEXT, DATE, JSONB, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_quote(UUID, UUID, TEXT, TEXT, DATE, JSONB, NUMERIC)
  TO service_role;
