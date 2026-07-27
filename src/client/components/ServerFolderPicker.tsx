import { useMemo, useState } from 'react'
import { asyncDataLoaderFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { useServerFn } from '@tanstack/react-start'
import { ChevronRight, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listStorageDirectories } from '../../server/fns'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'

type DirectoryItem = { path: string; name: string }

export function ServerFolderPicker({
  open,
  initialPath,
  workspaceSlug,
  onSelect,
  onClose,
}: {
  open: boolean
  initialPath: string
  workspaceSlug: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const listDirectories = useServerFn(listStorageDirectories)
  const [selectedPath, setSelectedPath] = useState(initialPath)
  const [problem, setProblem] = useState<string>()
  const expandedItems = useMemo(() => ancestors(initialPath), [initialPath])
  const tree = useTree<DirectoryItem>({
    rootItemId: '/',
    getItemName: (item) => item.getItemData().name,
    isItemFolder: () => true,
    dataLoader: {
      getItem: (itemPath) => ({ path: itemPath, name: itemPath === '/' ? 'Server filesystem' : basename(itemPath) }),
      // A folder the server cannot read must say so; otherwise the row sits on "Loading…" forever.
      getChildren: async (itemPath) => {
        try {
          const { directories } = await listDirectories({ data: { path: itemPath, workspaceSlug } })
          setProblem(undefined)
          return directories.map((directory) => directory.path)
        } catch (error) {
          setProblem(error instanceof Error && error.message ? error.message : `${itemPath} could not be read.`)
          return []
        }
      },
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
    <DialogShell
      open={open}
      title="Choose a server folder"
      description="These are folders visible inside the STL Quest server or container. Host folders must be mounted before they appear here."
      className="sm:max-w-xl"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
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
                className={`flex cursor-default items-center gap-1 rounded-md border-l-2 py-1.5 pr-2 text-sm outline-none hover:bg-muted hover:text-foreground focus:bg-muted ${itemPath === selectedPath ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-muted-foreground'}`}
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
        <DialogProblem
          title="That folder could not be opened"
          hint="The server may not have permission to read it, or it may not be mounted into the container."
          error={problem}
        />
        <div className="flex justify-end gap-2">
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
        </div>
      </div>
    </DialogShell>
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
