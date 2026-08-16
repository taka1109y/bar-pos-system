export default function Section({ title, desc, children }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-4 md:p-5 shadow-sm">
      {(title || desc) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-bold text-heading">{title}</h3>}
          {desc && <p className="text-xs text-muted mt-0.5">{desc}</p>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}
