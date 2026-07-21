'use client'

import { useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type TableMeta,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type DataTableFilter = {
  columnId: string
  label: string
  allOption: { value: string; label: string }
  options: ReadonlyArray<{ value: string; label: string }>
  className?: string
}

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  emptyMessage: string
  itemLabel: { singular: string; plural: string }
  search?: { label: string; placeholder: string }
  filters?: DataTableFilter[]
  initialSorting?: SortingState
  initialPageSize?: number
  pageSizeOptions?: readonly number[]
  meta?: TableMeta<TData>
  alignLastColumnRight?: boolean
  onRowClick?: (row: TData) => void
  getRowLabel?: (row: TData) => string
}

const EMPTY_FILTERS: DataTableFilter[] = []
const EMPTY_SORTING: SortingState = []
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage,
  itemLabel,
  search,
  filters = EMPTY_FILTERS,
  initialSorting = EMPTY_SORTING,
  initialPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  meta,
  alignLastColumnRight = false,
  onRowClick,
  getRowLabel,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
    meta,
  })
  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <div>
      {(search || filters.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {search && (
            <InputGroup className="max-w-sm flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={search.label}
                placeholder={search.placeholder}
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
              />
            </InputGroup>
          )}
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId)
            const value = (column?.getFilterValue() as string | undefined) ?? filter.allOption.value
            const items = [filter.allOption, ...filter.options]
            return (
              <Select
                key={filter.columnId}
                items={items}
                value={value}
                onValueChange={(nextValue) => column?.setFilterValue(nextValue === filter.allOption.value ? undefined : nextValue)}
              >
                <SelectTrigger className={filter.className} aria-label={filter.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          })}
        </div>
      )}
      <div className="overflow-hidden rounded-lg">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header, index) => (
                  <TableHead key={header.id} className={cn(alignLastColumnRight && index === group.headers.length - 1 && 'text-right')}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown />
                        ) : (
                          <ArrowUpDown />
                        )}
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none')}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={getRowLabel?.(row.original)}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick(row.original)
                          }
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      className={cn(alignLastColumnRight && index === row.getVisibleCells().length - 1 && 'text-right')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
        <span>
          {filteredCount} {filteredCount === 1 ? itemLabel.singular : itemLabel.plural}
        </span>
        <div className="flex items-center gap-2">
          <Select
            items={pageSizeOptions.map((size) => ({ value: String(size), label: `${size} per page` }))}
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger aria-label={`${itemLabel.plural[0].toUpperCase()}${itemLabel.plural.slice(1)} per page`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export { DataTable }
export type { DataTableFilter, DataTableProps }
