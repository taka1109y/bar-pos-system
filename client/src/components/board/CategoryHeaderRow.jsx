// 価格ボードのカテゴリ見出し行。
// continued=true のときは、そのカテゴリがページを跨いだ「続き」ページなので「（続き）」を付す。
export default function CategoryHeaderRow({ name, continued = false }) {
  return (
    <tr className="border-b border-slate-700/60">
      <td
        colSpan={7}
        className="board-display px-4 py-2.5 text-[#ff9d3c] text-[1.75rem] font-bold uppercase tracking-[0.3em]"
      >
        {name}
        {continued && (
          <span className="ml-3 text-base tracking-widest text-slate-500 normal-case">（続き）</span>
        )}
      </td>
    </tr>
  );
}
