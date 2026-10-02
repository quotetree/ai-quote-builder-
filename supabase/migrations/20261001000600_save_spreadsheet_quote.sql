-- Saves the spreadsheet editor's quote over an existing quote and replaces its items in one transaction, so an
-- API key update cannot land between the quote write and the item writes. Runs with the caller's permissions.

CREATE OR REPLACE FUNCTION public.save_spreadsheet_quote(p_quote_id UUID, p_quote JSONB, p_items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
BEGIN
  -- The quote row lock taken here is held until commit. An API update takes the same lock first, so the two
  -- saves run one after the other and the stored totals always match the stored items.
  UPDATE quotes q SET
    (subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total_price, profit_margin,
     charges, baked_markups, spreadsheet_id, scope_of_work, status, quote_name) =
    (SELECT r.subtotal, r.tax_rate, r.tax_amount, r.discount_rate, r.discount_amount, r.total_price, r.profit_margin,
       r.charges, r.baked_markups, r.spreadsheet_id, r.scope_of_work, r.status, r.quote_name
     FROM jsonb_populate_record(NULL::quotes, p_quote) r),
    version_number = coalesce(q.version_number, 1) + 1
  WHERE q.id = p_quote_id
  RETURNING q.version_number INTO v_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % not found', p_quote_id USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM quote_items WHERE quote_id = p_quote_id;

  INSERT INTO quote_items (quote_id, product_id, product_number, product_name, description,
    quantity, unit_price, discount_percent, line_total, sort_order)
  SELECT p_quote_id, i.product_id, i.product_number, i.product_name, i.description,
    i.quantity, i.unit_price, i.discount_percent, i.line_total, i.sort_order
  FROM jsonb_populate_recordset(NULL::quote_items, p_items) AS i;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.save_spreadsheet_quote(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_spreadsheet_quote(UUID, JSONB, JSONB) TO authenticated;
