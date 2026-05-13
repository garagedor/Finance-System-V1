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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset search and focus the input when the dropdown opens.
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      // Defer until the dropdown is in the DOM.
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
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
          <div className="multiselect-options-list">
            {!searchTerm && (
              <div
                className={`multiselect-option ${isAllSelected ? 'selected' : ''}`}
                onClick={handleAllClick}
              >
                <div className={`custom-checkbox ${isAllSelected ? 'checked' : ''}`}></div>
                <span>{allLabel}</span>
              </div>
            )}
            {filteredOptions.length === 0 ? (
              <div className="multiselect-empty">No matches</div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option}
                  className={`multiselect-option ${selected.includes(option) ? 'selected' : ''}`}
                  onClick={() => toggleOption(option)}
                >
                  <div className={`custom-checkbox ${selected.includes(option) ? 'checked' : ''}`}></div>
                  <span>{option}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
