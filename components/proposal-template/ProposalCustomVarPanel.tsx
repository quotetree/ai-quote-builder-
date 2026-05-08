"use client";

import { useState } from "react";
import { Plus, Trash2, Variable, X } from "lucide-react";
import { ElementType } from "./proposalTemplateTypes";

interface ProposalCustomVarPanelProps {
  onAddVariable: (type: ElementType, variableName: string) => void;
  onClose: () => void;
}

export default function ProposalCustomVarPanel({
  onAddVariable,
  onClose,
}: ProposalCustomVarPanelProps) {
  const [variables, setVariables] = useState<string[]>([
    "Client.Name",
    "Client.Company",
    "Client.Email",
    "Project.Title",
    "Project.Date",
  ]);
  const [newVarName, setNewVarName] = useState("");

  const addVariable = () => {
    const trimmed = newVarName.trim();
    if (!trimmed || variables.includes(trimmed)) return;
    setVariables((v) => [...v, trimmed]);
    setNewVarName("");
  };

  const removeVariable = (name: string) => {
    setVariables((v) => v.filter((x) => x !== name));
  };

  return (
    <div className="w-56 border-l border-gray-200 bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Variable size={15} className="text-green-600" />
          <span className="text-sm font-semibold text-gray-800">Custom Variables</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <p className="text-xs text-gray-500 px-4 pt-3 pb-1">
        Click a variable to insert it into the template.
      </p>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {variables.map((v) => (
          <div
            key={v}
            className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-green-50 cursor-pointer transition-colors"
            onClick={() => {
              onAddVariable("custom_variable", v);
              onClose();
            }}
          >
            <span className="text-xs font-mono text-green-700 truncate">{`{{${v}}}`}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeVariable(v);
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
              title="Remove variable"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {variables.length === 0 && (
          <p className="text-xs text-gray-400 italic px-2 py-4 text-center">
            No variables yet. Add one below.
          </p>
        )}
      </div>

      <div className="px-3 py-3 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-600 mb-1.5">New variable</p>
        <div className="flex gap-1">
          <input
            type="text"
            value={newVarName}
            onChange={(e) => setNewVarName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addVariable()}
            placeholder="e.g. Client.Phone"
            className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-400"
          />
          <button
            onClick={addVariable}
            disabled={!newVarName.trim()}
            className="p-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Add variable"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
