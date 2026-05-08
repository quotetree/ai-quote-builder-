"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerPopupProps {
  value?: string; // "YYYY-MM-DD"
  onSelect: (isoDate: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toIso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function DatePickerPopup({
  value,
  onSelect,
  onClear,
  onClose,
}: DatePickerPopupProps) {
  const today = new Date();
  const initial = value ? new Date(value + "T12:00:00") : today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const selectedIso = value ?? null;
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const yearRange = Array.from({ length: 20 }, (_, i) => today.getFullYear() - 5 + i);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const handleDayClick = (day: number) => {
    onSelect(toIso(viewYear, viewMonth, day));
    onClose();
  };

  return (
    <div
      className="absolute z-[60] bg-white border border-gray-200 rounded-xl shadow-2xl"
      style={{ top: "calc(100% + 6px)", left: 0, minWidth: 288 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Month / Year header */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <select
          value={viewMonth}
          onChange={(e) => setViewMonth(Number(e.target.value))}
          className="flex-1 text-sm font-semibold border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-green-500"
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i}>{m}</option>
          ))}
        </select>
        <select
          value={viewYear}
          onChange={(e) => setViewYear(Number(e.target.value))}
          className="text-sm font-semibold border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-green-500"
        >
          {yearRange.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={prevMonth}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={nextMonth}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-3 pb-1">
        {DAY_HEADERS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[11px] font-semibold py-1 ${
              i === 0 ? "text-red-500" : "text-gray-400"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 px-3 pb-3">
        {/* Leading empty cells */}
        {Array.from({ length: firstDayOfWeek }, (_, i) => (
          <div key={`e-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const iso = toIso(viewYear, viewMonth, day);
          const isSunday = (firstDayOfWeek + i) % 7 === 0;
          const isSelected = iso === selectedIso;
          const isToday =
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day;

          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              className={`text-center text-sm py-1.5 mx-0.5 rounded-full transition-colors ${
                isSelected
                  ? "bg-green-600 text-white font-semibold"
                  : isToday
                  ? "bg-green-100 text-green-700 font-semibold"
                  : isSunday
                  ? "text-red-500 hover:bg-gray-100"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Clear */}
      <div className="border-t border-gray-100 px-3 py-2.5 text-center">
        <button
          onClick={() => { onClear(); onClose(); }}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
