export type EditPoint = { x: number; y: number };
export type EditRegion = {
  id: number;
  tool: 'brush' | 'rectangle' | 'magic';
  prompt: string;
  maskDataUrl: string;
  edgeDataUrl: string;
  center: EditPoint;
  bounds: { x: number; y: number; width: number; height: number };
};
type Snapshot = { regions: EditRegion[]; activeId: number | null; nextId: number };

export class ImageStudioEditSession {
  state: Snapshot = { regions: [], activeId: null, nextId: 1 };
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  private textBase: Snapshot | null = null;

  private snapshot(): Snapshot {
    return { ...this.state, regions: this.state.regions.map((item) => ({ ...item })) };
  }

  private remember(before = this.snapshot()) {
    this.past.push(before);
    if (this.past.length > 30) this.past.shift();
    this.future = [];
  }

  get valid() { return this.state.regions.filter((item) => item.prompt.trim()); }
  get pending() { return this.state.regions.find((item) => !item.prompt.trim()); }

  setPrompt(id: number, prompt: string) {
    if (!this.textBase) this.textBase = this.snapshot();
    this.state = { ...this.state, regions: this.state.regions.map((item) => item.id === id ? { ...item, prompt } : item) };
  }

  commitText() {
    if (!this.textBase) return;
    if (this.textBase.regions.some((item, index) => item.prompt !== this.state.regions[index]?.prompt)) this.remember(this.textBase);
    this.textBase = null;
  }

  private discardPending(id: number) {
    const prior = this.past[this.past.length - 1];
    const remaining = this.state.regions.filter((item) => item.id !== id);
    if (prior && prior.nextId === id && prior.regions.length === remaining.length &&
      prior.regions.every((item, index) => item.id === remaining[index].id)) this.past.pop();
    this.state = { ...this.state, regions: remaining, activeId: null };
    this.textBase = null;
  }

  settle() {
    const active = this.state.regions.find((item) => item.id === this.state.activeId);
    if (!active || active.prompt.trim()) { this.commitText(); return; }
    const before = this.textBase || this.snapshot();
    if (before.regions.find((item) => item.id === active.id)?.prompt.trim()) {
      this.textBase = null;
      this.state = { ...this.state, regions: this.state.regions.filter((item) => item.id !== active.id), activeId: null };
      this.remember(before);
    } else this.discardPending(active.id);
  }

  add(input: Omit<EditRegion, 'id' | 'prompt'>) {
    this.settle();
    this.remember();
    const id = this.state.nextId;
    this.state = { regions: [...this.state.regions, { ...input, id, prompt: '' }], activeId: id, nextId: id + 1 };
    return id;
  }

  activate(id: number) {
    if (id === this.state.activeId) return;
    this.settle();
    if (this.state.regions.some((item) => item.id === id)) this.state = { ...this.state, activeId: id };
  }

  delete(id: number, record = true) {
    const item = this.state.regions.find((region) => region.id === id);
    if (!item) return;
    const before = this.textBase || this.snapshot();
    this.textBase = null;
    if (record) this.remember(before);
    const regions = this.state.regions.filter((region) => region.id !== id);
    this.state = { ...this.state, regions, activeId: regions[Math.min(this.state.regions.indexOf(item), regions.length - 1)]?.id ?? null };
  }

  clear() {
    if (!this.state.regions.length) return;
    const before = this.textBase || this.snapshot();
    this.textBase = null;
    this.remember(before);
    this.state = { ...this.state, regions: [], activeId: null };
  }

  undo() {
    if (this.pending && this.state.activeId === this.pending.id && !this.textBase?.regions.find((item) => item.id === this.pending?.id)?.prompt.trim()) {
      this.discardPending(this.pending.id);
      return true;
    }
    const before = this.textBase || this.past.pop();
    if (!before) return false;
    this.future.push(this.snapshot());
    this.state = before;
    this.textBase = null;
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot());
    this.state = next;
    this.textBase = null;
    return true;
  }
}
