export const applyRecentProjectFilter = (cards: NodeListOf<HTMLElement>, queryRaw: string): void => {
  const query = queryRaw.trim().toLowerCase();
  cards.forEach((card) => {
    const text = card.textContent?.toLowerCase() ?? "";
    const visible = query.length === 0 || text.includes(query);
    card.classList.toggle("d-none", !visible);
  });
};
