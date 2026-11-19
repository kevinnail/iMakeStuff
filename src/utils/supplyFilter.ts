// The group filter's first and last choices. A saved group is a name, never a number, so neither
// clashes with one.
export const allSuppliesKey = -1;
export const noGroupKey = -2;

export type GroupKey = string | number;

interface FilteredSupply {
  name: string;
  group_name?: string | null;
}

// All supplies, each group in alphabetical order, then No group when some supply has none. Empty
// when no supply has a group, since there's nothing to filter by.
export function getGroupOptions(supplies: FilteredSupply[]) {
  const groups = [
    ...new Set(supplies.flatMap(({ group_name }) => (group_name ? [group_name] : []))),
  ].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }));
  if (groups.length === 0) return [];
  const ungrouped = supplies.some(({ group_name }) => !group_name);
  return [
    { key: allSuppliesKey, label: 'All supplies' },
    ...groups.map((group) => ({ key: group, label: group })),
    ...(ungrouped ? [{ key: noGroupKey, label: 'No group' }] : []),
  ];
}

// The chosen group, or All supplies once the dropdown no longer offers it, like after its last
// supply moved to another group or was deleted. Otherwise the list stays empty under a group that
// can't be picked.
export function keepOfferedGroup(supplies: FilteredSupply[], groupKey: GroupKey) {
  const offered = getGroupOptions(supplies).some(({ key }) => key === groupKey);
  return offered ? groupKey : allSuppliesKey;
}

// The supplies in the chosen group whose names contain the search, in their order. The search
// ignores case and the spaces around it.
export function filterSupplies<Supply extends FilteredSupply>(
  supplies: Supply[],
  groupKey: GroupKey,
  searchText: string,
) {
  const search = searchText.trim().toLowerCase();
  return supplies.filter(
    ({ name, group_name }) =>
      (groupKey === allSuppliesKey ||
        (groupKey === noGroupKey ? !group_name : group_name === groupKey)) &&
      name.toLowerCase().includes(search),
  );
}
