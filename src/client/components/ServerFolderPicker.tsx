import { useMemo, useState } from 'react'
import { asyncDataLoaderFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { useServerFn } from '@tanstack/react-start'
import { ChevronRight, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listStorageDirectories } from '../../server/fns'

type DirectoryItem = { path: string; name: string }

export function ServerFolderPicker({
  open,
  initialPath,
  onSelect,
  onClose,
}: {
  open: boolean
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const listDirectories = useServerFn(listStorageDirectories)
  const [selectedPath, setSelectedPath] = useState(initialPath)
  const expandedItems = useMemo(() => ancestors(initialPath), [initialPath])
  const tree = useTree<DirectoryItem>({
    rootItemId: '/',
    getItemName: (item) => item.getItemData().name,
    isItemFolder: () => true,
    dataLoader: {
      getItem: (itemPath) => ({ path: itemPath, name: itemPath === '/' ? 'Server filesystem' : basename(itemPath) }),
      getChildren: async (itemPath) => (await listDirectories({ data: { path: itemPath } })).directories.map((directory) => directory.path),
    },
    createLoadingItemData: () => ({ path: '', name: 'Loading…' }),
    features: [asyncDataLoaderFeature, selectionFeature],
    initialState: { expandedItems, selectedItems: [initialPath] },
    onPrimaryAction: (item) => {
      setSelectedPath(item.getId())
      if (item.isExpanded()) item.collapse()
      else item.expand()
    },
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a server folder</DialogTitle>
          <DialogDescription>
            These are folders visible inside the PrintHub server or container. Host folders must be mounted before they appear here.
          </DialogDescription>
        </DialogHeader>
        <div {...tree.getContainerProps('Server folders')} className="max-h-[50vh] overflow-auto rounded-lg border p-2 outline-none">
          {tree.getItems().map((item) => {
            const itemPath = item.getId()
            const itemProps = item.getProps()
            const meta = item.getItemMeta()
            return (
              <button
                {...itemProps}
                key={item.getKey()}
                type="button"
                className={`flex cursor-default items-center gap-1 rounded-md py-1.5 pr-2 text-sm outline-none hover:bg-muted focus:bg-muted ${itemPath === selectedPath ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                style={{ paddingLeft: `${Math.max(0, meta.level - 1) * 16 + 4}px` }}
                onClick={(event) => {
                  itemProps.onClick?.(event)
                  setSelectedPath(itemPath)
                }}
                onDoubleClick={() => {
                  if (item.isExpanded()) item.collapse()
                  else item.expand()
                }}
              >
                <ChevronRight className={`size-4 shrink-0 transition-transform ${item.isExpanded() ? 'rotate-90' : ''}`} />
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{item.getItemName()}</span>
              </button>
            )
          })}
        </div>
        <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{selectedPath}</code>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(selectedPath)
              onClose()
            }}
          >
            Select folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ancestors(folderPath: string) {
  const paths = ['/']
  let current = '/'
  for (const segment of folderPath.split('/').filter(Boolean)) {
    current = current === '/' ? `/${segment}` : `${current}/${segment}`
    paths.push(current)
  }
  return paths
}

function basename(folderPath: string) {
  const segments = folderPath.split('/')
  for (let index = segments.length - 1; index >= 0; index--) {
    if (segments[index]) return segments[index]
  }
  return folderPath
}
