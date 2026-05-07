'use client';

import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FiCalendar } from 'react-icons/fi';
import './DateRangePicker.css';

interface DateRangePickerProps {
    startDate: string;
    endDate: string;
    onChange: (start: string, end: string) => void;
    className?: string;
}

export default function DateRangePicker({
    startDate,
    endDate,
    onChange,
    className = '',
}: DateRangePickerProps) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const handleChange = (dates: [Date | null, Date | null]) => {
        const [newStart, newEnd] = dates;

        // Convert to YYYY-MM-DD string, preserving local date by avoiding UTC conversion if possible
        // or simply using toISOString() slice if that's the project convention.
        // The project uses d.toISOString().slice(0, 10) which implies UTC dates or ignoring timezone offsets.
        // However, DatePicker returns local date objects.
        // Let's use a safe local-to-string conversion:

        const formatDate = (d: Date | null) => {
            if (!d) return '';
            // Create a date string in YYYY-MM-DD format using local time
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (newStart || newEnd) {
            onChange(formatDate(newStart), formatDate(newEnd));
        } else {
            onChange('', '');
        }
    };

    return (
        <div className={`date-range-picker-wrapper ${className}`}>
            <div className="input-with-icon">
                <FiCalendar className="calendar-icon" />
                <DatePicker
                    selectsRange={true}
                    startDate={start}
                    endDate={end}
                    onChange={handleChange}
                    className="custom-date-input"
                    placeholderText="Select date range"
                    dateFormat="MM/dd/yy"
                    isClearable={false}
                    portalId="root"
                />
            </div>
        </div>
    );
}
