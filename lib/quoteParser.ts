// Utility functions for parsing and extracting quotes from AI chat responses

export interface ParsedQuoteItem {
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface ParsedQuote {
  project_name: string;
  line_items: ParsedQuoteItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount_amount: number;
  total_price: number;
  profit_margin?: number;
  cost_basis?: number;
  generated_at: string;
}

/**
 * Detects if a message contains a generated quote
 */
export function containsQuote(content: string): boolean {
  return content.includes('QUOTE GENERATED') || 
         (content.includes('Line Items') && content.includes('Subtotal'));
}

/**
 * Extracts a structured quote object from AI response text
 */
export function parseQuoteFromMessage(content: string, projectName: string): ParsedQuote | null {
  if (!containsQuote(content)) {
    return null;
  }

  try {
    const quote: ParsedQuote = {
      project_name: projectName,
      line_items: [],
      subtotal: 0,
      tax_rate: 0,
      tax_amount: 0,
      discount_amount: 0,
      total_price: 0,
      generated_at: new Date().toISOString(),
    };

    // Extract line items from table
    const tableMatch = content.match(/\|.*?\|.*?\|.*?\|.*?\|.*?\|/g);
    
    if (tableMatch && tableMatch.length > 2) {
      // Skip header and separator rows
      const itemRows = tableMatch.slice(2);
      
      itemRows.forEach(row => {
        const cells = row.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);
        
        if (cells.length >= 5) {
          const [productName, description, qty, unitPrice, lineTotal] = cells;
          
          // Parse numbers, handling currency symbols and commas
          const quantity = parseFloat(qty.replace(/[^0-9.-]/g, ''));
          const unit_price = parseFloat(unitPrice.replace(/[^0-9.-]/g, ''));
          const line_total = parseFloat(lineTotal.replace(/[^0-9.-]/g, ''));
          
          if (!isNaN(quantity) && !isNaN(unit_price) && !isNaN(line_total)) {
            quote.line_items.push({
              product_name: productName,
              description: description || productName,
              quantity,
              unit_price,
              line_total,
            });
          }
        }
      });
    }

    // Extract financial totals
    const subtotalMatch = content.match(/Subtotal:\s*\$?([\d,]+\.?\d*)/i);
    if (subtotalMatch) {
      quote.subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ''));
    }

    const taxMatch = content.match(/Tax\s*\((\d+)%\):\s*\$?([\d,]+\.?\d*)/i);
    if (taxMatch) {
      quote.tax_rate = parseFloat(taxMatch[1]);
      quote.tax_amount = parseFloat(taxMatch[2].replace(/,/g, ''));
    }

    const discountMatch = content.match(/Discount:\s*-?\$?([\d,]+\.?\d*)/i);
    if (discountMatch) {
      quote.discount_amount = parseFloat(discountMatch[1].replace(/,/g, ''));
    }

    const totalMatch = content.match(/Total:\s*\$?([\d,]+\.?\d*)/i);
    if (totalMatch) {
      quote.total_price = parseFloat(totalMatch[1].replace(/,/g, ''));
    }

    // Extract profit information
    const profitMatch = content.match(/Projected Profit:\s*\$?([\d,]+\.?\d*)/i);
    if (profitMatch) {
      quote.profit_margin = parseFloat(profitMatch[1].replace(/,/g, ''));
    }

    const costMatch = content.match(/Cost Basis:\s*\$?([\d,]+\.?\d*)/i);
    if (costMatch) {
      quote.cost_basis = parseFloat(costMatch[1].replace(/,/g, ''));
    }

    // Validate we got at least some data
    if (quote.line_items.length === 0 && quote.total_price === 0) {
      return null;
    }

    return quote;
  } catch (error) {
    console.error('Error parsing quote from message:', error);
    return null;
  }
}

/**
 * Extracts natural language commands for quote modifications
 */
export interface QuoteModificationCommand {
  type: 'add_tax' | 'add_discount' | 'remove_item' | 'update_quantity' | 'add_item' | 'other';
  params: {
    percentage?: number;
    itemIndex?: number;
    itemName?: string;
    quantity?: number;
    targetItems?: string[];
  };
  originalCommand: string;
}

export function parseModificationCommand(message: string): QuoteModificationCommand | null {
  const lowerMessage = message.toLowerCase();

  // Add tax command: "add 9% tax", "apply 8% sales tax"
  const taxMatch = lowerMessage.match(/(?:add|apply)\s+(\d+(?:\.\d+)?)%?\s+(?:sales\s+)?tax/i);
  if (taxMatch) {
    return {
      type: 'add_tax',
      params: { percentage: parseFloat(taxMatch[1]) },
      originalCommand: message,
    };
  }

  // Add discount: "add 10% discount", "apply 5% discount to items A, B, C"
  const discountMatch = lowerMessage.match(/(?:add|apply)\s+(\d+(?:\.\d+)?)%?\s+discount(?:\s+to\s+(.+))?/i);
  if (discountMatch) {
    const targetItems = discountMatch[2] 
      ? discountMatch[2].split(/[,\s]+/).filter(Boolean)
      : undefined;
    
    return {
      type: 'add_discount',
      params: { 
        percentage: parseFloat(discountMatch[1]),
        targetItems,
      },
      originalCommand: message,
    };
  }

  // Remove item: "remove item 3", "delete line item 2"
  const removeMatch = lowerMessage.match(/(?:remove|delete)\s+(?:line\s+)?item\s+(\d+)/i);
  if (removeMatch) {
    return {
      type: 'remove_item',
      params: { itemIndex: parseInt(removeMatch[1]) - 1 }, // Convert to 0-based
      originalCommand: message,
    };
  }

  // Update quantity: "change item 2 quantity to 50", "update quantity of item 3 to 100"
  const quantityMatch = lowerMessage.match(/(?:change|update|set).*?item\s+(\d+).*?(?:quantity|qty).*?to\s+(\d+)/i);
  if (quantityMatch) {
    return {
      type: 'update_quantity',
      params: {
        itemIndex: parseInt(quantityMatch[1]) - 1,
        quantity: parseInt(quantityMatch[2]),
      },
      originalCommand: message,
    };
  }

  // Add item: "add [product name]"
  const addMatch = message.match(/add\s+(.+?)(?:\s+to|$)/i);
  if (addMatch && !lowerMessage.includes('tax') && !lowerMessage.includes('discount')) {
    return {
      type: 'add_item',
      params: { itemName: addMatch[1].trim() },
      originalCommand: message,
    };
  }

  return null;
}

/**
 * Formats a parsed quote as a clean summary for display
 */
export function formatQuoteSummary(quote: ParsedQuote): string {
  let summary = `**Quote Summary**\n\n`;
  summary += `**Items:** ${quote.line_items.length}\n`;
  summary += `**Subtotal:** $${quote.subtotal.toFixed(2)}\n`;
  
  if (quote.tax_amount > 0) {
    summary += `**Tax (${quote.tax_rate}%):** $${quote.tax_amount.toFixed(2)}\n`;
  }
  
  if (quote.discount_amount > 0) {
    summary += `**Discount:** -$${quote.discount_amount.toFixed(2)}\n`;
  }
  
  summary += `**Total:** $${quote.total_price.toFixed(2)}\n`;
  
  if (quote.profit_margin) {
    const marginPercent = quote.cost_basis 
      ? ((quote.profit_margin / quote.cost_basis) * 100).toFixed(1)
      : '0';
    summary += `\n**Profit:** $${quote.profit_margin.toFixed(2)} (${marginPercent}% margin)`;
  }
  
  return summary;
}







