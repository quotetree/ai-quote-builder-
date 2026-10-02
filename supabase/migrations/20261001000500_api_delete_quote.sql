-- Deletes a quote for an organization API key and records the write in api_key_audit in one transaction.
-- Callable by service_role only.

CREATE OR REPLACE FUNCTION public.api_delete_quote(
  p_organization_id UUID, p_key_id UUID, p_quote_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Cascades remove the quote's items, profit overrides, proposal and signatures
  DELETE FROM quotes WHERE id = p_quote_id AND organization_id = p_organization_id;
  v_status := CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END;

  PERFORM api_key_audit_log(p_key_id, p_organization_id, 'delete', p_quote_id, v_status);
  RETURN jsonb_build_object('status', v_status);
END;
$$;

-- REVOKE FROM PUBLIC alone leaves Supabase's default grants to anon and authenticated in place
REVOKE ALL ON FUNCTION public.api_delete_quote(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_delete_quote(UUID, UUID, UUID)
  TO service_role;
