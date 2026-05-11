'use client';

import React, { useEffect, useState } from 'react';
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

const formatDate = (d: Date | null): string => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDate = (s: string): Date | null => (s ? new Date(s) : null);

export default function DateRangePicker({
    startDate,
    endDate,
    onChange,
    className = '',
}: DateRangePickerProps) {
    // Keep Date refs stable across renders so react-datepicker's selectsRange
    // doesn't lose its in-progress range after the first click.
    const [range, setRange] = useState<[Date | null, Date | null]>(() => [
        parseDate(startDate),
        parseDate(endDate),
    ]);

    useEffect(() => {
        setRange((prev) => {
            const [prevStart, prevEnd] = prev;
            if (formatDate(prevStart) === startDate && formatDate(prevEnd) === endDate) {
                return prev;
            }
            return [parseDate(startDate), parseDate(endDate)];
        });
    }, [startDate, endDate]);

    const handleChange = (dates: [Date | null, Date | null]) => {
        setRange(dates);
        const [s, e] = dates;
        onChange(formatDate(s), formatDate(e));
    };

    return (
        <div className={`date-range-picker-wrapper ${className}`}>
            <div className="input-with-icon">
                <FiCalendar className="calendar-icon" />
                <DatePicker
                    selectsRange={true}
                    startDate={range[0] ?? undefined}
                    endDate={range[1] ?? undefined}
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
