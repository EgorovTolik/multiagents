export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-3xl text-white/80 hover:text-white"
        onClick={onClose}
        aria-label="Закрыть"
      >
        ✕
      </button>
      <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Preview" className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" />
        <div className="mt-3 flex justify-center">
          <a
            href={url}
            download
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            ⬇ Скачать
          </a>
        </div>
      </div>
    </div>
  );
}
