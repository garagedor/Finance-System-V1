import React, { useState, useRef, useEffect, useMemo } from 'react';
import './MultiSelect.css';

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  // When true, selecting an option replaces the selection and closes the
  // dropdown (single-select mode). The selected array always has 0 or 1 items.
  single?: boolean;
  // Disable the in-dropdown search input. Defaults to enabled.
  searchable?: boolean;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  allLabel = 'All',
  single = false,
  searchable = true,
}: MultiSelectProps) {
  // Defensive: tolerate callers that hand us a stale string (e.g. legacy
  // single-select state surviving an HMR after this filter went multi).
  const safeSelected: string[] = Array.isArray(selected)
    ? selected
    : (typeof selected === 'string' && selected ? [selected] : []);
  selected = safeSelected;
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsListRef = useRef<HTMLDivElement>(null);
  const selectedOptionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset search, focus the input, and scroll the first selected option
  // into view when the dropdown opens — so reopening a filter that's
  // already narrowed (e.g. "Yanai") lands on that row instead of the top
  // of a long list.
  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm('');
    // Defer to next frame so the dropdown is in the DOM.
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      const target = selectedOptionRef.current;
      const list = optionsListRef.current;
      if (target && list) {
        // Scroll the row into the middle of the visible area.
        const offset = target.offsetTop - (list.clientHeight / 2) + (target.clientHeight / 2);
        list.scrollTop = Math.max(0, offset);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  const toggleOption = (option: string) => {
    if (single) {
      onChange([option]);
      setIsOpen(false);
      return;
    }
    const newSelected = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    onChange(newSelected);
  };

  const isAllSelected = selected.length === 0;

  const handleAllClick = () => {
    onChange([]);
    if (single) setIsOpen(false);
  };

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const q = searchTerm.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, searchTerm]);

  const getDisplayText = () => {
    if (selected.length === 0) return allLabel;
    if (!single && selected.length === options.length) return 'All Selected';
    if (selected.length === 1) return selected[0];
    return `${selected.length} Selected`;
  };

  return (
    <div className="multiselect-container" ref={containerRef}>
      <div
        className={`multiselect-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="multiselect-text">{getDisplayText()}</span>
        <span className="multiselect-arrow"></span>
      </div>

      {isOpen && (
        <div className="multiselect-dropdown">
          {searchable && (
            <div className="multiselect-search-row">
              <input
                ref={searchInputRef}
                type="text"
                className="multiselect-search-input"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="multiselect-options-list" ref={optionsListRef}>
            {!searchTerm && (
              <div
                ref={isAllSelected ? selectedOptionRef : undefined}
                className={`multiselect-option ${isAllSelected ? 'selected' : ''}`}
                onClick={handleAllClick}
              >
                <div className={`custom-checkbox ${isAllSelected ? 'checked' : ''}`}></div>
                <span>{allLabel}</span>
              </div>
            )}
            {filteredOptions.length === 0 ? (
              <div className="multiselect-empty">No matches</div>
            ) : (() => {
              // Pin selectedOptionRef to the FIRST selected option so the
              // scroll-into-view effect lands on it.
              const firstSelected = filteredOptions.find((o) => selected.includes(o));
              return filteredOptions.map((option) => {
                const isSel = selected.includes(option);
                const isFirstSelected = !isAllSelected && option === firstSelected;
                return (
                  <div
                    key={option}
                    ref={isFirstSelected ? selectedOptionRef : undefined}
                    className={`multiselect-option ${isSel ? 'selected' : ''}`}
                    onClick={() => toggleOption(option)}
                  >
                    <div className={`custom-checkbox ${isSel ? 'checked' : ''}`}></div>
                    <span>{option}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
