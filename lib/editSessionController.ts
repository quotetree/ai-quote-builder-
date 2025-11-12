/**
 * Edit Session Controller
 * 
 * Manages quote edit sessions with:
 * - Session isolation (no cross-quote contamination)
 * - Rehydration of approved versions
 * - Concurrency control
 * - Diff tracking
 * - Audit logging
 */

import { createClient } from "@/lib/supabase/client";
import { logErr, inspectErr } from '@/lib/util/errorTools';
import { normalizeBakedMarkups, rehydrateBakedMarkupsIntoItems } from '@/lib/quote/bakedMarkups';
import { 
  Quote, 
  QuoteItem, 
  QuoteEditSession, 
  QuoteSnapshot, 
  QuoteDiffSummary,
  ChargeConfig,
  ProductSuggestion,
  QuotePreview
} from "@/types/database";

// Generate unique edit session ID
export function generateEditSessionId(): string {
  return `edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Log edit operations
function logEditOperation(
  operation: string, 
  data: Record<string, any>
): void {
  console.log(`[EditSession] ${operation}:`, JSON.stringify(data));
}

/**
 * Start an edit session for a quote
 * Returns the session ID and rehydrated snapshot
 */
export async function startEditSession(
  quoteId: string,
  projectId: string
): Promise<{
  sessionId: string;
  snapshot: QuoteSnapshot;
  version: number;
}> {
  const supabase = createClient();
  
  logEditOperation('edit:start', { quoteId, projectId });
  
  try {
    // Verify schema exists (only in development)
    if (process.env.NODE_ENV === 'development') {
      const { verifyEditQuoteSchema } = await import('./verifyEditQuoteSchema');
      const schemaCheck = await verifyEditQuoteSchema();
      
      if (!schemaCheck.isValid) {
        const errorMsg = [
          'Edit Quote database schema not found.',
          schemaCheck.missingTables.length > 0 ? `Missing tables: ${schemaCheck.missingTables.join(', ')}` : '',
          schemaCheck.missingColumns.length > 0 ? `Missing columns: ${schemaCheck.missingColumns.join(', ')}` : '',
          'Please apply the migration: supabase/migrations/20241107_add_quote_edit_sessions.sql'
        ].filter(Boolean).join(' ');
        
        throw new Error(errorMsg);
      }
    }
    
    // Get the current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Not authenticated");
    }

    // Fetch the quote with all its items (* includes baked_markups, charges, discounts)
    console.log('[EditSession] Fetching quote:', quoteId);
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select(`
        *,
        items:quote_items(*)
      `)
      .eq("id", quoteId)
      .single();

    if (quoteError) {
      console.error('[EditSession] Error fetching quote:', {
        message: quoteError.message,
        code: quoteError.code,
        details: quoteError.details,
        hint: quoteError.hint,
        raw: JSON.stringify(quoteError)
      });
      throw quoteError;
    }
    if (!quote) throw new Error("Quote not found");
    
    console.log('[EditSession] Quote fetched:', {
      id: quote.id,
      version: quote.version_number,
      isEditing: quote.is_editing,
      itemCount: quote.items?.length || 0,
      hasBakedMarkups: !!(quote as any).baked_markups,
      bakedMarkupsCount: ((quote as any).baked_markups || []).length,
      hasCharges: !!quote.charges,
      chargesCount: (quote.charges || []).length
    });

    // Check if quote is already being edited
    if (quote.is_editing && quote.edit_session_id) {
      // Check if there's an active session
      const { data: existingSession } = await supabase
        .from("quote_edit_sessions")
        .select("*")
        .eq("id", quote.edit_session_id)
        .eq("status", "active")
        .single();
      
      if (existingSession) {
        logEditOperation('edit:resume', { 
          quoteId, 
          existingSessionId: quote.edit_session_id 
        });
        
        return {
          sessionId: quote.edit_session_id,
          snapshot: existingSession.snapshot as QuoteSnapshot,
          version: quote.version_number
        };
      }
    }

    // Load charges and baked markups from the quote itself (not working state)
    // Note: Database returns snake_case (baked_markups) but we use camelCase in app
    const charges = quote.charges || [];
    const bakedMarkups = (quote as any).baked_markups || quote.bakedMarkups || [];
    
    console.log('[EditSession] Loaded charges and markups from quote:', {
      quoteId: quote.id,
      chargeCount: charges.length,
      bakedMarkupCount: bakedMarkups.length,
      itemsWithDiscounts: (quote.items || []).filter((i: any) => i.discount_percent > 0).length,
      charges: charges.map((c: any) => ({ name: c.name, rate: c.rate, amount: c.calculated_amount })),
      bakedMarkups: bakedMarkups.map((m: any) => ({ label: m.label, percent: m.percent, total: m.audited?.totalMarkup }))
    });

    // Normalize baked_markups (handle null, wrong shape, camelCase legacy)
    const quoteForNormalize: any = { ...quote, baked_markups: bakedMarkups };
    normalizeBakedMarkups(quoteForNormalize);
    
    // Create snapshot of current state
    const snapshot: QuoteSnapshot = {
      quote: {
        ...quote,
        items: undefined // Remove items from quote object
      } as Quote,
      items: (quote.items || []) as QuoteItem[],
      charges: charges,
      bakedMarkups: quoteForNormalize.baked_markups  // Use normalized version
    };
    
    console.log('[EditSession] Snapshot created:', {
      quoteId: quote.id,
      itemCount: snapshot.items.length,
      chargeCount: snapshot.charges?.length || 0,
      bakedMarkupCount: snapshot.bakedMarkups?.length || 0,
      items: snapshot.items.map(i => ({ name: i.product_name, qty: i.quantity }))
    });

    // Generate new edit session ID
    const sessionId = generateEditSessionId();

    // Create edit session record
    const { error: sessionError } = await supabase
      .from("quote_edit_sessions")
      .insert({
        id: sessionId,
        quote_id: quoteId,
        project_id: projectId,
        user_id: user.id,
        version_being_edited: quote.version_number,
        snapshot: snapshot,
        status: 'active'
      });

    if (sessionError) throw sessionError;

    // Mark quote as being edited
    const { error: updateError } = await supabase
      .from("quotes")
      .update({
        is_editing: true,
        edit_session_id: sessionId
      })
      .eq("id", quoteId);

    if (updateError) throw updateError;

    logEditOperation('edit:rehydrate', {
      quoteId,
      sessionId,
      version: quote.version_number,
      itemCount: snapshot.items.length
    });

    return {
      sessionId,
      snapshot,
      version: quote.version_number
    };

  } catch (error: any) {
    const info = logErr('startEditSession', error);
    logEditOperation('edit:error', { 
      operation: 'startEditSession',
      quoteId, 
      error: info.message,
      code: info.code,
      hint: info.hint
    });
    // Throw enriched error so LogPanel sees real details
    throw new Error(`[EditSession] ${info.message || 'Unknown error'} :: ${info.code || ''} :: ${info.hint || ''}`);
  }
}

/**
 * Load edit session into project working state
 */
export async function rehydrateEditSession(
  sessionId: string,
  projectId: string
): Promise<{
  suggestedProducts: ProductSuggestion[];
  quotePreview: QuotePreview;
}> {
  const supabase = createClient();
  
  try {
    console.log('[rehydrateEditSession] Starting', { sessionId, projectId });
    
    // Get the edit session
    const { data: session, error: sessionError } = await supabase
      .from("quote_edit_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("status", "active")
      .single();

    if (sessionError) {
      console.error('[rehydrateEditSession] Session fetch error:', sessionError instanceof Error ? sessionError.message : JSON.stringify(sessionError));
      throw sessionError;
    }
    if (!session) throw new Error("Edit session not found or expired");

    const snapshot = session.snapshot as QuoteSnapshot;
    
    console.log('[rehydrateEditSession] Snapshot loaded:', {
      itemCount: snapshot.items?.length || 0,
      bakedMarkupsCount: snapshot.bakedMarkups?.length || 0
    });
    
    // Normalize and rehydrate baked_markups before processing
    const snapshotForRehydrate: any = {
      items: snapshot.items || [],
      baked_markups: snapshot.bakedMarkups || []
    };
    
    try {
      normalizeBakedMarkups(snapshotForRehydrate);
      rehydrateBakedMarkupsIntoItems(snapshotForRehydrate);
      console.log('[rehydrateEditSession] Rehydration complete');
    } catch (rehydrateErr) {
      console.error('[rehydrateEditSession] Rehydration error:', rehydrateErr instanceof Error ? rehydrateErr.message : JSON.stringify(rehydrateErr));
      // Continue anyway - rehydration failure shouldn't block editing
    }
    
    console.log('[EditSession] Rehydrating snapshot:', {
      sessionId,
      itemCount: snapshot.items?.length || 0,
      chargeCount: snapshot.charges?.length || 0,
      bakedMarkupCount: snapshot.bakedMarkups?.length || 0,
      items: snapshot.items?.map((i: any) => ({ name: i.product_name, qty: i.quantity })) || [],
      charges: snapshot.charges?.map((c: any) => ({ name: c.name, amount: c.calculated_amount })) || [],
      bakedMarkups: snapshot.bakedMarkups?.map((m: any) => ({ label: m.label, percent: m.percent })) || []
    });

    // Convert quote items to suggested products format (use rehydrated items with bakedAdjustments)
    let suggestedProducts: ProductSuggestion[] = snapshotForRehydrate.items.map((item: any) => ({
      id: item.product_id || undefined,
      product_name: item.product_name,
      description: item.description || "",
      quantity: Number(item.quantity || 0) || 0,
      unit_price: Number(item.unit_price || 0) || 0,
      line_total: Number(item.line_total || 0) || 0,
      selected: true,
      discount_percent: Number(item.discount_percent || 0) || 0,
      bakedAdjustments: item.bakedAdjustments // Already set by rehydrateBakedMarkupsIntoItems
    }));

    // Items already have bakedAdjustments from rehydrateBakedMarkupsIntoItems above
    // Now restore baseline prices (items should display WITHOUT markup, then show "+ Markup" below)
    const bakedMarkups = snapshot.bakedMarkups || [];
    
    if (bakedMarkups.length > 0) {
      suggestedProducts = suggestedProducts.map(item => {
        if (!item.bakedAdjustments || !item.bakedAdjustments.markupTotal) return item;
        
        const markupAmount = item.bakedAdjustments.markupTotal;
        
        // Calculate baseline by removing markup from current prices
        const baselineLineTotal = item.line_total - markupAmount;
        const baselineUnitPrice = item.quantity > 0 
          ? baselineLineTotal / item.quantity 
          : item.unit_price;
        
        return {
          ...item,
          unit_price: baselineUnitPrice,  // Display baseline (before markup)
          line_total: baselineLineTotal   // Display baseline (before markup)
          // bakedAdjustments stays - UI will show "Includes Markup: +$X"
        };
      });
      
      const itemsWithMarkups = suggestedProducts.filter(i => i.bakedAdjustments && (i.bakedAdjustments.markupTotal || 0) > 0);
      console.log('[EditSession] ✓ Restored baselines for', itemsWithMarkups.length, 'items with markups');
    }

    // Build quote preview
    const quotePreview: QuotePreview = {
      line_items: suggestedProducts,
      subtotal: Number(snapshot.quote.subtotal),
      tax_rate: Number(snapshot.quote.tax_rate),
      tax_amount: Number(snapshot.quote.tax_amount),
      discount_amount: Number(snapshot.quote.discount_amount),
      total_price: Number(snapshot.quote.total_price),
      charges: snapshot.charges || [],
      bakedMarkups: bakedMarkups // Use the one we read, ensure it's passed to UI
    };
    
    console.log('[EditSession] 🔍 FINAL PREVIEW DEBUG:', {
      lineItemsCount: quotePreview.line_items.length,
      lineItemsWithBakedAdjustments: quotePreview.line_items.filter(i => i.bakedAdjustments).length,
      bakedMarkupsCount: quotePreview.bakedMarkups?.length || 0,
      sampleItemWithMarkup: quotePreview.line_items.find(i => i.bakedAdjustments)
    });
    
    console.log('[EditSession] Quote preview created:', {
      lineItemCount: quotePreview.line_items.length,
      chargeCount: quotePreview.charges?.length || 0,
      bakedMarkupCount: quotePreview.bakedMarkups?.length || 0,
      itemsWithDiscounts: quotePreview.line_items.filter(i => i.discount_percent && i.discount_percent > 0).length,
      itemsWithBakedAdjustments: quotePreview.line_items.filter(i => i.bakedAdjustments && i.bakedAdjustments.markupTotal && i.bakedAdjustments.markupTotal > 0).length,
      lineItems: quotePreview.line_items.map(i => ({ name: i.product_name, qty: i.quantity, discount: i.discount_percent || 0, bakedMarkup: i.bakedAdjustments?.markupTotal || 0 })),
      charges: quotePreview.charges?.map(c => ({ name: c.name, amount: c.calculated_amount })) || [],
      bakedMarkups: quotePreview.bakedMarkups?.map(m => ({ label: m.label, percent: m.percent, total: m.audited?.totalMarkup })) || [],
      total: quotePreview.total_price
    });

    // Update project working state to edit mode
    const { error: stateError } = await supabase
      .from("project_working_state")
      .upsert({
        project_id: projectId,
        suggested_products: [],  // Keep suggestions empty in edit mode
        quote_preview: quotePreview,
        show_split_view: true,
        edit_mode: true,
        current_edit_session_id: sessionId,
        current_quote_id: session.quote_id,
        edit_started_at: new Date().toISOString()
      }, { onConflict: 'project_id' });

    if (stateError) throw stateError;

    // Telemetry for rehydration
    const itemsWithMarkups = suggestedProducts.filter(i => i.bakedAdjustments && (i.bakedAdjustments.markupTotal || 0) > 0).length;
    if (bakedMarkups.length > 0) {
      const totalTargets = bakedMarkups.reduce((sum, m) => sum + (m.targets?.length || 0), 0);
      console.log('[Telemetry] rehydrate:bakedMarkups { rules:', bakedMarkups.length, ', itemsAffected:', itemsWithMarkups, ', totalTargets:', totalTargets, ', unmatched:', unmatchedTargetCount || 0, '}');
    }
    
    logEditOperation('edit:loaded', {
      sessionId,
      projectId,
      itemCount: suggestedProducts.length,
      total: quotePreview.total_price,
      bakedMarkupsRehydrated: bakedMarkups.length,
      itemsWithMarkups,
      unmatchedTargets: unmatchedTargetCount || 0
    });

    return {
      suggestedProducts,
      quotePreview
    };

  } catch (error: any) {
    console.error('[rehydrateEditSession]', error instanceof Error ? error.message : JSON.stringify(error));
    const info = logErr('rehydrateEditSession', error);
    logEditOperation('edit:error', { 
      operation: 'rehydrateEditSession',
      sessionId, 
      error: info.message,
      code: info.code,
      hint: info.hint
    });
    // Throw enriched error so UI sees real details
    throw new Error(`[Rehydrate] ${info.message || 'Unknown error'} :: ${info.code || ''} :: ${info.hint || ''}`);
  }
}

/**
 * Validate if a string is a valid UUID (not a composite ID)
 */
function isValidUUID(str: string | undefined | null): boolean {
  if (!str) return false;
  
  // Reject composite IDs (e.g., "pool-uuid-timestamp-shard")
  if (str.startsWith('pool-') || str.includes('-') && str.split('-').length > 5) {
    return false;
  }
  
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Extract pure UUID from a value, or return null if not a valid UUID
 */
function sanitizeProductId(id: string | undefined | null): string | null {
  if (!id) return null;
  
  // If it's a composite ID, log it and return null
  if (id.startsWith('pool-')) {
    console.log('[UUID] Rejecting composite pool ID for product_id:', id.substring(0, 50) + '...');
    console.log('[Telemetry] submit:uuidRejected { field: "product_id", valueSample:', id.substring(0, 50), '}');
    return null;
  }
  
  // If it's a valid UUID, return it
  if (isValidUUID(id)) {
    return id;
  }
  
  // Otherwise, return null
  console.log('[UUID] Rejecting invalid UUID for product_id:', id);
  return null;
}

/**
 * Check if fast-forward merge is possible (no overlapping changes)
 */
function checkFastForwardPossible(
  baseSnapshot: QuoteSnapshot,
  currentState: { items: any[]; quote: any },
  proposedChanges: { items: ProductSuggestion[] }
): boolean {
  // Simple heuristic: check if current state differs from base
  // If it doesn't, fast-forward is always safe
  if (currentState.quote.version_number === baseSnapshot.quote.version_number) {
    return true;
  }
  
  // Check if the items that changed between base and current
  // overlap with items that changed in proposed
  const baseItemNames = new Set(baseSnapshot.items.map(i => i.product_name));
  const currentItemNames = new Set(currentState.items.map((i: any) => i.product_name));
  const proposedItemNames = new Set(proposedChanges.items.map(i => i.product_name));
  
  // Find items changed between base and current
  const changedInCurrent = new Set<string>();
  currentState.items.forEach((item: any) => {
    const baseItem = baseSnapshot.items.find(i => i.product_name === item.product_name);
    if (!baseItem || 
        baseItem.quantity !== item.quantity || 
        baseItem.unit_price !== item.unit_price) {
      changedInCurrent.add(item.product_name);
    }
  });
  
  // Find items changed in proposed
  const changedInProposed = new Set<string>();
  proposedChanges.items.forEach(item => {
    const baseItem = baseSnapshot.items.find(i => i.product_name === item.product_name);
    if (!baseItem || 
        baseItem.quantity !== item.quantity || 
        baseItem.unit_price !== item.unit_price) {
      changedInProposed.add(item.product_name);
    }
  });
  
  // Check for overlap
  for (const itemName of changedInCurrent) {
    if (changedInProposed.has(itemName)) {
      return false; // Overlapping change detected
    }
  }
  
  return true; // No overlap, fast-forward is safe
}

/**
 * Calculate diff between original and modified quote
 */
export function calculateQuoteDiff(
  original: QuoteSnapshot | { items: any[]; quote: any },
  modified: {
    items: ProductSuggestion[];
    subtotal: number;
    total_price: number;
  }
): QuoteDiffSummary {
  // Normalize original to consistent format
  const originalItems = 'items' in original ? original.items : [];
  const originalQuote = 'quote' in original ? original.quote : original;
  const diff: QuoteDiffSummary = {
    items_added: [],
    items_removed: [],
    items_modified: [],
    subtotal_delta: modified.subtotal - Number(originalQuote.subtotal),
    total_delta: modified.total_price - Number(originalQuote.total_price)
  };

  // Create maps for comparison
  const originalItemsMap = new Map(
    originalItems.map((item: any) => [item.product_name, item])
  );
  const modifiedItemsMap = new Map(
    modified.items.map(item => [item.product_name, item])
  );

  // Find added and modified items
  modified.items.forEach(modItem => {
    const origItem = originalItemsMap.get(modItem.product_name);
    
    if (!origItem) {
      // Item was added
      diff.items_added?.push({
        product_name: modItem.product_name,
        quantity: modItem.quantity,
        unit_price: modItem.unit_price,
        line_total: modItem.line_total
      });
    } else {
      // Check if item was modified
      const qtyChanged = Number(modItem.quantity) !== Number(origItem.quantity);
      const priceChanged = Number(modItem.unit_price) !== Number(origItem.unit_price);
      
      if (qtyChanged || priceChanged) {
        diff.items_modified?.push({
          product_name: modItem.product_name,
          quantity: modItem.quantity,
          unit_price: modItem.unit_price,
          line_total: modItem.line_total,
          old_quantity: Number(origItem.quantity),
          old_unit_price: Number(origItem.unit_price),
          old_line_total: Number(origItem.line_total)
        });
      }
    }
  });

  // Find removed items
  originalItems.forEach((origItem: any) => {
    if (!modifiedItemsMap.has(origItem.product_name)) {
      diff.items_removed?.push({
        product_name: origItem.product_name,
        quantity: Number(origItem.quantity),
        unit_price: Number(origItem.unit_price),
        line_total: Number(origItem.line_total)
      });
    }
  });

  return diff;
}

/**
 * Submit edited quote as new version
 * Implements optimistic concurrency control with fast-forward merge
 */
export async function submitEditedQuote(
  sessionId: string,
  modifiedQuote: {
    items: ProductSuggestion[];
    subtotal: number;
    tax_rate: number;
    tax_amount: number;
    discount_amount: number;
    total_price: number;
    profit_margin: number;
    charges?: ChargeConfig[];
    bakedMarkups?: import("@/types/database").BakedMarkupConfig[];
  },
  baseVersion: number,
  changeNotes?: string
): Promise<Quote> {
  const supabase = createClient();
  
  try {
    // Get the current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Get the edit session
    const { data: session, error: sessionError } = await supabase
      .from("quote_edit_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("status", "active")
      .single();

    if (sessionError) {
      console.error("[submitEditedQuote] Session fetch error:", sessionError);
      throw new Error(`DB_ERROR: ${sessionError.message}`);
    }
    if (!session) throw new Error("EDIT_SESSION_NOT_FOUND: Edit session not found or expired");

    const snapshot = session.snapshot as QuoteSnapshot;

    // CONCURRENCY CHECK: Verify quote hasn't been modified since session started
    const { data: currentQuote, error: fetchError } = await supabase
      .from("quotes")
      .select("*, quote_items(*)")
      .eq("id", session.quote_id)
      .single();

    if (fetchError) {
      console.error("[submitEditedQuote] Quote fetch error:", fetchError);
      throw new Error(`DB_ERROR: ${fetchError.message}`);
    }

    // Check if another edit session has modified the quote
    if (currentQuote.edit_session_id && currentQuote.edit_session_id !== sessionId && currentQuote.is_editing) {
      console.log('[Submit] submit:conflict { quoteId:', session.quote_id, ', base:', baseVersion, ', current:', currentQuote.version_number, ', overlap: true }');
      
      const error = new Error("CONCURRENCY_CONFLICT: Another user is currently editing this quote");
      (error as any).code = "CONCURRENCY_CONFLICT";
      (error as any).details = {
        currentVersion: currentQuote.version_number,
        editingSession: currentQuote.edit_session_id
      };
      throw error;
    }

    // Check if quote version has changed - attempt fast-forward merge
    if (currentQuote.version_number !== baseVersion) {
      console.log('[Submit] Version mismatch detected. Base:', baseVersion, 'Current:', currentQuote.version_number);
      
      // Attempt fast-forward merge - check if changes overlap
      const canFastForward = checkFastForwardPossible(
        snapshot,
        { items: currentQuote.quote_items, quote: currentQuote },
        modifiedQuote
      );
      
      if (canFastForward) {
        // Auto-merge: no overlapping changes
        console.log('[Submit] submit:mergedFastForward { from: v' + baseVersion + ', to: v' + (currentQuote.version_number + 1) + ' }');
        // Continue with submission using currentQuote as new base
      } else {
        // True conflict: overlapping changes detected
        console.log('[Submit] submit:conflict { base:', baseVersion, ', current:', currentQuote.version_number, ', overlap: true }');
        
        const error = new Error("VERSION_CONFLICT: Quote has been modified with overlapping changes");
        (error as any).code = "VERSION_CONFLICT";
        (error as any).details = {
          baseVersion,
          currentVersion: currentQuote.version_number,
          hasOverlap: true,
          currentQuote: {
            id: currentQuote.id,
            version: currentQuote.version_number,
            items: currentQuote.quote_items
          }
        };
        throw error;
      }
    }

    // Calculate diff (use currentQuote if version changed, else snapshot)
    const diffBase = currentQuote.version_number !== baseVersion
      ? { items: currentQuote.quote_items, quote: currentQuote }
      : snapshot;
    
    const diff = calculateQuoteDiff(diffBase, modifiedQuote);

    // Create new version (increment from current, not base)
    const newVersion = currentQuote.version_number + 1;

    // Update the original quote with new version
    const { data: updatedQuote, error: updateError } = await supabase
      .from("quotes")
      .update({
        version_number: newVersion,
        subtotal: modifiedQuote.subtotal,
        tax_rate: modifiedQuote.tax_rate,
        tax_amount: modifiedQuote.tax_amount,
        discount_amount: modifiedQuote.discount_amount,
        total_price: modifiedQuote.total_price,
        profit_margin: modifiedQuote.profit_margin,
        charges: modifiedQuote.charges || [], // Save charges with quote
        baked_markups: modifiedQuote.bakedMarkups || [], // Save baked markups with quote (DB uses snake_case)
        change_notes: changeNotes || null,
        diff_summary: diff,
        author_id: user.id,
        is_editing: false,
        edit_session_id: null
        // Note: parent_quote_id stays null - we're updating the same quote record
      })
      .eq("id", session.quote_id)
      .select()
      .single();
    
    console.log('[Submit] Updated quote with charges and markups:', {
      quoteId: session.quote_id,
      newVersion,
      chargeCount: modifiedQuote.charges?.length || 0,
      bakedMarkupCount: modifiedQuote.bakedMarkups?.length || 0
    });

    if (updateError) {
      console.error('[EditSession] Error updating quote:', updateError);
      console.error('[EditSession] Error details:', {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint
      });
      
      // Create structured error
      const structuredError: any = new Error(updateError.message || "Failed to update quote");
      structuredError.code = updateError.code || "DB_ERROR";
      structuredError.details = {
        operation: "update_quote",
        quoteId: session.quote_id,
        ...updateError
      };
      throw structuredError;
    }
    
    if (!updatedQuote) {
      throw new Error("Failed to update quote - no data returned");
    }

    // Delete old quote items
    await supabase
      .from("quote_items")
      .delete()
      .eq("quote_id", session.quote_id);

    // Insert new quote items
    const newItems = modifiedQuote.items.map((item, index) => ({
      quote_id: session.quote_id,
      product_id: sanitizeProductId(item.id), // Only use valid UUIDs, reject composite IDs
      product_number: null,
      product_name: item.product_name,
      description: item.description || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percent: item.discount_percent || 0,
      line_total: item.line_total,
      sort_order: index
    }));

    const { error: itemsError } = await supabase
      .from("quote_items")
      .insert(newItems);

    if (itemsError) {
      console.error('[EditSession] Error inserting quote items:', itemsError);
      const structuredError: any = new Error(itemsError.message || "Failed to insert quote items");
      structuredError.code = itemsError.code || "DB_ERROR";
      structuredError.details = {
        operation: "insert_quote_items",
        quoteId: session.quote_id,
        itemCount: newItems.length,
        ...itemsError
      };
      throw structuredError;
    }

    // Mark session as completed
    await supabase
      .from("quote_edit_sessions")
      .update({ status: 'completed' })
      .eq("id", sessionId);

    // Clear project working state edit mode
    await supabase
      .from("project_working_state")
      .update({
        edit_mode: false,
        current_edit_session_id: null,
        current_quote_id: null,
        edit_started_at: null
      })
      .eq("project_id", session.project_id);

    // Generate human-readable diff summary
    const diffSummaryText = generateDiffSummaryText(diff);

    console.log('[Submit] submit:success { quoteId:', session.quote_id, ', newVersion:', newVersion, ', session:', sessionId, '}');
    
    logEditOperation('edit:submit', {
      quoteId: session.quote_id,
      sessionId,
      fromVersion: session.version_being_edited,
      toVersion: newVersion,
      diffSummary: diffSummaryText
    });

    return updatedQuote;

  } catch (error: any) {
    console.error('[submitEditedQuote] Caught error:', error);
    
    // Ensure we always have a structured error
    if (!error || typeof error !== 'object') {
      const fallbackError: any = new Error("Unknown error during quote submission");
      fallbackError.code = "UNKNOWN_ERROR";
      fallbackError.details = { originalError: String(error) };
      
      logEditOperation('edit:error', { 
        operation: 'submitEditedQuote',
        sessionId, 
        code: 'UNKNOWN_ERROR',
        error: String(error)
      });
      
      throw fallbackError;
    }
    
    // Ensure error has code and message
    if (!error.code) {
      error.code = error.name || "DB_ERROR";
    }
    if (!error.message) {
      error.message = "An error occurred during quote submission";
    }
    
    logEditOperation('edit:error', { 
      operation: 'submitEditedQuote',
      sessionId, 
      code: error.code,
      message: error.message,
      details: error.details
    });
    
    throw error;
  }
}

/**
 * Cancel an edit session
 */
export async function cancelEditSession(
  sessionId: string
): Promise<void> {
  const supabase = createClient();
  
  try {
    // Get the edit session
    const { data: session } = await supabase
      .from("quote_edit_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (!session) return; // Session doesn't exist, nothing to cancel

    // Mark session as cancelled
    await supabase
      .from("quote_edit_sessions")
      .update({ status: 'cancelled' })
      .eq("id", sessionId);

    // Clear quote editing flag
    await supabase
      .from("quotes")
      .update({
        is_editing: false,
        edit_session_id: null
      })
      .eq("id", session.quote_id);

    // Clear project working state edit mode
    await supabase
      .from("project_working_state")
      .update({
        edit_mode: false,
        current_edit_session_id: null,
        current_quote_id: null,
        edit_started_at: null
      })
      .eq("project_id", session.project_id);

    logEditOperation('edit:cancel', { sessionId, quoteId: session.quote_id });

  } catch (error: any) {
    logEditOperation('edit:error', { 
      operation: 'cancelEditSession',
      sessionId, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Generate human-readable diff summary
 */
function generateDiffSummaryText(diff: QuoteDiffSummary): string {
  const parts: string[] = [];

  if (diff.items_added && diff.items_added.length > 0) {
    parts.push(`Added ${diff.items_added.length} item(s): ${diff.items_added.map(i => i.product_name).join(', ')}`);
  }

  if (diff.items_removed && diff.items_removed.length > 0) {
    parts.push(`Removed ${diff.items_removed.length} item(s): ${diff.items_removed.map(i => i.product_name).join(', ')}`);
  }

  if (diff.items_modified && diff.items_modified.length > 0) {
    parts.push(`Modified ${diff.items_modified.length} item(s): ${diff.items_modified.map(i => i.product_name).join(', ')}`);
  }

  if (diff.total_delta && diff.total_delta !== 0) {
    const sign = diff.total_delta > 0 ? '+' : '';
    parts.push(`Total changed by ${sign}$${diff.total_delta.toFixed(2)}`);
  }

  return parts.join('; ') || 'No changes';
}

/**
 * Check if a project is currently in edit mode
 */
export async function isProjectInEditMode(projectId: string): Promise<{
  isEditing: boolean;
  sessionId: string | null;
  quoteId: string | null;
}> {
  const supabase = createClient();
  
  try {
    const { data } = await supabase
      .from("project_working_state")
      .select("edit_mode, current_edit_session_id, current_quote_id")
      .eq("project_id", projectId)
      .single();

    if (!data) {
      return { isEditing: false, sessionId: null, quoteId: null };
    }

    return {
      isEditing: data.edit_mode || false,
      sessionId: data.current_edit_session_id,
      quoteId: data.current_quote_id
    };

  } catch (error) {
    return { isEditing: false, sessionId: null, quoteId: null };
  }
}

