import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ nextDialog: null as unknown, cleanups: [] as (() => void)[], id: 0 }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useId: () => `modal-${++harness.id}`,
  useRef: (value: unknown) => ({ current: value === null ? harness.nextDialog : value }),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
}));
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));
import { Modal } from "./components";

let active: ElementStub | null;
class ElementStub {
  isConnected = true;
  children: ElementStub[] = [];
  focus = vi.fn(() => { active = this; });
  getClientRects = () => [{}];
  contains(element: unknown): boolean { return element === this || this.children.includes(element as ElementStub); }
  querySelector = () => this.children[0] ?? null;
  querySelectorAll = () => this.children;
}
let documentStub: { body: { style: { overflow: string } }; readonly activeElement: ElementStub | null;
  addEventListener: (type: string, callback: (event: KeyEvent) => void) => void;
  removeEventListener: (type: string, callback: (event: KeyEvent) => void) => void };
type KeyEvent = { key: string; shiftKey: boolean; defaultPrevented: boolean; preventDefault: () => void };
let listeners: Set<(event: KeyEvent) => void>;
let frames: Map<number, () => void>;
let nextFrame: number;

beforeEach(() => {
  active = null;
  listeners = new Set(); frames = new Map(); nextFrame = 0;
  harness.cleanups = [];
  documentStub = { body: { style: { overflow: "auto" } }, get activeElement() { return active; },
    addEventListener: (_type, callback) => { listeners.add(callback); },
    removeEventListener: (_type, callback) => { listeners.delete(callback); } };
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});
afterEach(() => {
  for (const cleanup of [...harness.cleanups].reverse()) cleanup();
  harness.cleanups = [];
  vi.unstubAllGlobals();
});
function open(dialog: ElementStub, onClose = vi.fn()) {
  harness.nextDialog = dialog;
  Modal({ title: "测试弹窗", onClose, children: null });
  const effectCleanup = harness.cleanups.at(-1)!;
  return () => { effectCleanup(); harness.cleanups = harness.cleanups.filter((cleanup) => cleanup !== effectCleanup); };
}
function key(value: string, shiftKey = false) {
  const event: KeyEvent = { key: value, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  for (const listener of [...listeners]) listener(event);
  return event;
}
function flushFrames() {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback();
}

describe("nested modal keyboard and focus", () => {
  it("routes Escape only to the top dialog and restores parent focus without unlocking page scroll", () => {
    const opener = new ElementStub(); opener.focus();
    const parent = new ElementStub(); const parentButton = new ElementStub(); parent.children = [parentButton];
    const closeParent = vi.fn(); const removeParent = open(parent, closeParent); flushFrames();
    const child = new ElementStub(); const childInput = new ElementStub(); child.children = [childInput];
    const closeChild = vi.fn(); const removeChild = open(child, closeChild); flushFrames();
    expect(active).toBe(childInput);
    key("Escape");
    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
    removeChild();
    expect(active).toBe(parentButton);
    expect(documentStub.body.style.overflow).toBe("hidden");
    key("Escape");
    expect(closeParent).toHaveBeenCalledTimes(1);
    removeParent();
    expect(active).toBe(opener);
    expect(documentStub.body.style.overflow).toBe("auto");
  });

  it("keeps Tab cycling inside the top dialog and prevents a parent's delayed autofocus stealing focus", () => {
    const parent = new ElementStub(); const parentButton = new ElementStub(); parent.children = [parentButton];
    open(parent);
    const child = new ElementStub(); const first = new ElementStub(); const last = new ElementStub(); child.children = [first, last];
    open(child); flushFrames();
    expect(parentButton.focus).not.toHaveBeenCalled();
    expect(active).toBe(first);
    expect(key("Tab", true).defaultPrevented).toBe(true);
    expect(active).toBe(last);
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(active).toBe(first);
  });

  it("keeps scroll locked when a parent unmounts first and returns to the original opener after the child closes", () => {
    const opener = new ElementStub(); opener.focus();
    const parent = new ElementStub(); const parentButton = new ElementStub(); parent.children = [parentButton];
    const removeParent = open(parent); flushFrames();
    const child = new ElementStub(); const removeChild = open(child); flushFrames();
    parent.isConnected = false; parentButton.isConnected = false;
    removeParent();
    expect(documentStub.body.style.overflow).toBe("hidden");
    removeChild();
    expect(documentStub.body.style.overflow).toBe("auto");
    expect(active).toBe(opener);
  });
});
