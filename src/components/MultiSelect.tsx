import React, { useState, useRef, useEffect } from 'react';
import './MultiSelect.css';

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  allLabel?: string;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  allLabel = 'All',
}: MultiSelectProps) {
  // Defensive: tolerate callers that hand us a stale string (e.g. legacy
  // single-select state surviving an HMR after this filter went multi).
  const safeSelected: string[] = Array.isArray(selected)
    ? selected
    : (typeof selected === 'string' && selected ? [selected] : []);
  selected = safeSelected;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (option: string) => {
    let newSelected: string[];
    if (selected.includes(option)) {
      newSelected = selected.filter((item) => item !== option);
    } else {
      newSelected = [...selected, option];
    }
    onChange(newSelected);
  };

  const isAllSelected = selected.length === 0;

  const handleAllClick = () => {
    onChange([]);
  };

  const getDisplayText = () => {
    if (selected.length === 0) return allLabel;
    if (selected.length === options.length) return 'All Selected';
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
          <div 
            className={`multiselect-option ${isAllSelected ? 'selected' : ''}`}
            onClick={handleAllClick}
          >
            <div className={`custom-checkbox ${isAllSelected ? 'checked' : ''}`}></div>
            <span>{allLabel}</span>
          </div>
          {options.map((option) => (
            <div 
              key={option} 
              className={`multiselect-option ${selected.includes(option) ? 'selected' : ''}`}
              onClick={() => toggleOption(option)}
            >
              <div className={`custom-checkbox ${selected.includes(option) ? 'checked' : ''}`}></div>
              <span>{option}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
