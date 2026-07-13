export default function CategoryHeaderRow({ name }) {
  return (
    <tr className="bg-slate-800/90 border-b border-slate-700">
      <td colSpan={8} className="px-4 py-2.5 text-amber-400 font-bold text-sm tracking-widest uppercase">
        {name}
      </td>
    </tr>
  );
}
