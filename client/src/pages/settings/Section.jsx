export default function Section({ title, desc, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
