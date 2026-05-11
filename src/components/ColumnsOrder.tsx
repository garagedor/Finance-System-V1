'use client';

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    type DragStartEvent,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiGrid, FiChevronDown, FiX } from 'react-icons/fi';
import { useClickOutside } from '@/hooks/useClickOutside';

type ColumnConfig<T> = {
    key: keyof T | string;
    label: string;
};

type ColumnsOrderProps<T> = {
    columns: ColumnConfig<T>[];
    columnOrder: (keyof T | string)[];
    setColumnOrder: (order: (keyof T | string)[]) => void;
    hiddenColumns: string[];
    toggleColumn: (key: string) => void;
};

function SortableItem({
    id,
    label,
    visible,
    onToggle,
}: {
    id: string;
    label: string;
    visible: boolean;
    onToggle: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 999 : 'auto',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group flex items-center px-3 py-2 mb-1 bg-white border border-slate-200 rounded-lg gap-3 select-none hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm ${isDragging ? 'border-blue-400 bg-blue-50 shadow-md transform scale-[1.02] z-50' : ''
                }`}
        >
            <div
                className="flex items-center justify-center text-slate-400 p-1 rounded hover:bg-slate-200 hover:text-slate-600 cursor-grab active:cursor-grabbing transition-colors touch-none"
                {...attributes}
                {...listeners}
            >
                <FiGrid size={16} />
            </div>

            <label className="flex-1 flex items-center justify-between cursor-pointer">
                <span className="flex-1 text-sm font-medium text-slate-700 text-center px-2">
                    {label}
                </span>
                <div className="flex items-center justify-center w-8">
                    <input
                        type="checkbox"
                        checked={visible}
                        onChange={onToggle}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer accent-blue-600"
                    />
                </div>
            </label>
        </div>
    );
}

export function ColumnsOrder<T>({
    columns,
    columnOrder,
    setColumnOrder,
    hiddenColumns,
    toggleColumn,
}: ColumnsOrderProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const orderedColumns = useMemo(() => {
        return columnOrder
            .map((key) => columns.find((c) => c.key === key))
            .filter(Boolean) as ColumnConfig<T>[];
    }, [columnOrder, columns]);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = columnOrder.indexOf(active.id as string);
            const newIndex = columnOrder.indexOf(over.id as string);
            setColumnOrder(arrayMove(columnOrder, oldIndex, newIndex) as any);
        }
        setActiveId(null);
    };

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    // Track viewport-relative coords so the popover can be `position: fixed`
    // and escape any ancestor `overflow: hidden` (the table page uses that).
    const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);

    // Custom outside-click that respects BOTH the trigger container and the
    // portaled popover (since the popover is no longer a DOM child of the
    // trigger after createPortal).
    useEffect(() => {
        if (!isOpen) return;
        const handler = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            if (containerRef.current?.contains(target)) return;
            if (popoverRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [isOpen]);

    const computePos = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return { top: rect.bottom + 8, right: window.innerWidth - rect.right };
    };

    useEffect(() => {
        if (!isOpen) return;
        const reposition = () => {
            const next = computePos();
            if (next) setPopoverPos(next);
        };
        // Recompute on scroll/resize while open. The initial position is set
        // synchronously inside the click handler so there's no first-frame gap.
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [isOpen]);

    const handleToggle = () => {
        if (!isOpen) {
            // Set position before flipping state so the popover is rendered
            // with valid coords on the very next paint.
            setPopoverPos(computePos());
        }
        setIsOpen((v) => !v);
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                ref={triggerRef}
                className={`flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium text-sm text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all ${isOpen ? 'bg-blue-50 border-blue-200 text-blue-600' : ''
                    }`}
                onClick={handleToggle}
            >
                Columns
                <FiChevronDown
                    className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
                        }`}
                />
            </button>

            {isOpen && typeof document !== 'undefined' && createPortal((
                <div
                    ref={popoverRef}
                    className="w-72 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[500px]"
                    style={{
                        position: 'fixed',
                        top: popoverPos?.top ?? 80,
                        right: popoverPos?.right ?? 20,
                        zIndex: 9999,
                    }}
                >
                    <div className="flex justify-between items-center p-3 border-b border-slate-100 bg-slate-50 shrink-0">
                        <span className="text-sm font-semibold text-slate-900">
                            Manage Columns
                        </span>
                        <button
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-200"
                            onClick={() => setIsOpen(false)}
                        >
                            <FiX size={16} />
                        </button>
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="p-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent flex-1">
                            <SortableContext
                                items={columnOrder as string[]}
                                strategy={verticalListSortingStrategy}
                            >
                                {orderedColumns.map((col) => (
                                    <SortableItem
                                        key={col.key as string}
                                        id={col.key as string}
                                        label={col.label}
                                        visible={!hiddenColumns.includes(col.key as string)}
                                        onToggle={() => toggleColumn(col.key as string)}
                                    />
                                ))}
                            </SortableContext>
                        </div>

                        <DragOverlay>
                            {activeId ? (
                                <div className="flex items-center justify-between p-2 bg-white border border-blue-500 rounded-lg shadow-lg opacity-90 cursor-grabbing w-full">
                                    <div className="flex items-center justify-center text-slate-400 mr-2">
                                        <FiGrid size={16} />
                                    </div>
                                    <span className="flex-1 text-sm font-medium text-slate-700 text-center">
                                        {columns.find((c) => c.key === activeId)?.label}
                                    </span>
                                    <div className="w-8 flex justify-center">
                                        <div className="w-4 h-4 border border-blue-500 rounded bg-blue-50"></div>
                                    </div>
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                </div>
            ), document.body)}
        </div>
    );
}
