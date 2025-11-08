"use client";

import { useState, useEffect } from "react";
import { Plus, Download, Edit, Check, X } from "lucide-react";
import { useQuotes } from "@/hooks/useQuotes";
import { Quote } from "@/types/database";
import toast from "react-hot-toast";

interface LogPanelProps {
  projectId: string;
}

export default function LogPanel({ projectId }: LogPanelProps) {
  const { quotes, loading, fetchQuotes, updateQuoteStatus } = useQuotes(projectId);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchQuotes(projectId);
    }
  }, [projectId]);

  // Listen for quote creation events to refresh the log automatically
  useEffect(() => {
    const handleQuoteCreated = (event: CustomEvent) => {
      // Only refresh if the quote was created for this project
      if (event.detail.projectId === projectId) {
        console.log('New quote created, refreshing quote log...');
        fetchQuotes(projectId);
      }
    };

    window.addEventListener('quoteCreated' as any, handleQuoteCreated);
    
    return () => {
      window.removeEventListener('quoteCreated' as any, handleQuoteCreated);
    };
  }, [projectId, fetchQuotes]);

  const getStatusColor = (status: Quote['status']) => {
    switch (status) {
      case "approved":
        return "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400";
      case "for_approval":
        return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400";
      case "declined":
        return "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400";
    }
  };

  const handleStatusChange = async (quoteId: string, newStatus: Quote['status']) => {
    try {
      await updateQuoteStatus(quoteId, newStatus);
      toast.success("Status updated");
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const handleEditQuote = async (quote: Quote) => {
    try {
      console.log('[LogPanel] Starting edit for quote:', quote.id);
      
      // Import the edit session controller dynamically
      const { startEditSession, rehydrateEditSession } = await import("@/lib/editSessionController");
      
      toast.loading("Opening quote for editing...");
      
      // Start edit session
      console.log('[LogPanel] Calling startEditSession...');
      const { sessionId, snapshot, version } = await startEditSession(quote.id, projectId);
      console.log('[LogPanel] Session started:', sessionId);
      
      // Rehydrate into working state
      console.log('[LogPanel] Rehydrating session...');
      await rehydrateEditSession(sessionId, projectId);
      console.log('[LogPanel] Session rehydrated');
      
      toast.dismiss();
      toast.success(`Editing Quote v${version} (Session: ${sessionId.slice(0, 8)}...)`);
      
      // Dispatch event to switch to chat tab and show edit mode
      window.dispatchEvent(new CustomEvent('editQuoteStarted', { 
        detail: { 
          quoteId: quote.id,
          sessionId,
          version,
          quoteName: quote.quote_name
        } 
      }));
      
    } catch (error: any) {
      toast.dismiss();
      
      console.error('[LogPanel] Edit error details:', {
        error,
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        stack: error?.stack
      });
      
      // Check for database schema errors
      if (error?.code === '42P01' || error?.message?.includes('relation') || error?.message?.includes('does not exist')) {
        toast.error("Database migration not applied. Please run the edit quote migration first.");
        console.error('❌ Database schema error - migration needed. See EDIT_QUOTE_QUICK_START.md');
      } else if (error?.code === '42703' || error?.message?.includes('column') || error?.message?.includes('does not exist')) {
        toast.error("Database columns missing. Please apply the edit quote migration.");
        console.error('❌ Database columns missing - migration needed. See EDIT_QUOTE_QUICK_START.md');
      } else if (error?.message?.includes('CONCURRENCY_CONFLICT')) {
        toast.error("This quote is already being edited by another user");
      } else if (error?.message?.includes('VERSION_CONFLICT')) {
        toast.error("Quote has been updated. Please refresh and try again");
      } else if (error?.message) {
        toast.error(`Error: ${error.message}`);
      } else {
        toast.error("Failed to open quote for editing. Check console for details.");
      }
    }
  };

  const handleDownloadPDF = async (quote: Quote) => {
    try {
      const response = await fetch("/api/quotes/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });

      if (!response.ok) throw new Error("Failed to generate PDF");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.quote_number}_${quote.quote_name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success("PDF downloaded");
    } catch (error) {
      toast.error("Failed to download PDF");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading quotes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Quote Log</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2">
          <Plus size={18} />
          <span>Add New Quote</span>
        </button>
      </div>

      {/* Quotes Table */}
      {quotes.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <div className="text-6xl mb-4">📋</div>
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            No quotes generated yet
          </p>
          <p className="text-sm text-gray-500">
            Start a conversation in the Chat panel to generate your first quote
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Quote #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Margin
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    onClick={() => setSelectedQuote(quote)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                      {quote.quote_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {quote.quote_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      ${quote.total_price.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      ${quote.profit_margin.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(quote.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={quote.status}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleStatusChange(quote.id, e.target.value as Quote['status']);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-sm px-3 py-1 rounded-full font-medium ${getStatusColor(quote.status)}`}
                      >
                        <option value="draft">Draft</option>
                        <option value="for_approval">For Approval</option>
                        <option value="approved">Approved</option>
                        <option value="declined">Declined</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadPDF(quote);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          title="Download PDF"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditQuote(quote);
                          }}
                          className="p-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={quote.is_editing ? "Quote is being edited" : "Edit Quote"}
                          disabled={quote.is_editing}
                        >
                          <Edit size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quote Detail Modal */}
      {selectedQuote && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedQuote(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold">{selectedQuote.quote_name}</h3>
                <p className="text-gray-500">{selectedQuote.quote_number}</p>
              </div>
              <button
                onClick={() => setSelectedQuote(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Subtotal</p>
                  <p className="text-xl font-semibold">${selectedQuote.subtotal.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Tax ({selectedQuote.tax_rate}%)</p>
                  <p className="text-xl font-semibold">${selectedQuote.tax_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-2xl font-bold text-blue-600">${selectedQuote.total_price.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Profit Margin</p>
                  <p className="text-2xl font-bold text-green-600">${selectedQuote.profit_margin.toLocaleString()}</p>
                </div>
              </div>
              {selectedQuote.items && selectedQuote.items.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Line Items</h4>
                  <div className="space-y-2">
                    {selectedQuote.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-sm text-gray-500">
                            Qty: {item.quantity} × ${item.unit_price.toLocaleString()}
                          </p>
                        </div>
                        <p className="font-semibold">${item.line_total.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

