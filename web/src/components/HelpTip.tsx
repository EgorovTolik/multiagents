import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TIP_W = 288; // w-72
const MARGIN = 8;

/**
 * Всплывающая подсказка — иконка «?» рядом с меткой поля.
 *
 * Рендерится порталом в document.body (fixed-позиционирование): форма скроллится
 * в контейнере с overflow, и любой absolutely-positioned элемент внутри него
 * обрезается по его границам — портал убирает это ограничение и гарантирует
 * отображение поверх drawer'а (z-50 > z-40).
 *
 * Закрывается по клику вне области, по скроллу и ресайзу.
 */
export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; arrowLeft: number; below: boolean } | null>(null);

  // Позиция над кнопкой (или под ней, если сверху не хватает места), с клампом в viewport
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let x = r.left + r.width / 2 - TIP_W / 2;
    x = Math.max(MARGIN, Math.min(x, window.innerWidth - TIP_W - MARGIN));
    const estH = 130;
    const below = r.top - 8 - estH < 0;
    setPos({
      x,
      y: below ? r.bottom + 8 : r.top - 8,
      arrowLeft: Math.max(16, Math.min(TIP_W - 16, r.left + r.width / 2 - x)),
      below,
    });
  }, [open]);

  // Закрытие по клику вне подсказки / скроллу / ресайзу
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (tipRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-500 hover:border-indigo-400 hover:text-indigo-300"
      >
        ?
      </button>
      {open && pos && createPortal(
        <span
          ref={tipRef}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: TIP_W,
            transform: pos.below ? undefined : "translateY(-100%)",
            zIndex: 50,
          }}
          className="block rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl"
        >
          {text}
          <span
            style={{ left: pos.arrowLeft, top: pos.below ? undefined : "100%", bottom: pos.below ? "100%" : undefined }}
            className={`absolute -translate-x-1/2 border-4 border-transparent ${pos.below ? "border-b-slate-700" : "border-t-slate-700"}`}
          />
        </span>,
        document.body,
      )}
    </>
  );
}
