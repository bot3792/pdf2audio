export type DragItems = { bookIds: string[]; folderIds: string[] };

const MIME = "application/x-libratory-items";

export function setDragItems(e: React.DragEvent, items: DragItems) {
  e.dataTransfer.setData(MIME, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "move";
}

export function hasDragItems(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(MIME);
}

export function getDragItems(e: React.DragEvent): DragItems | null {
  try {
    const raw = e.dataTransfer.getData(MIME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
