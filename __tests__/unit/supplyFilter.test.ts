import {
  allSuppliesKey,
  filterSupplies,
  getGroupOptions,
  keepOfferedGroup,
  noGroupKey,
} from '@/utils/supplyFilter';

const supplies = [
  { name: 'Amber rod', group_name: 'Color rods' },
  { name: 'Silver bail', group_name: null },
  { name: 'Clear tube', group_name: 'Clear tubing' },
  { name: 'Cobalt rod', group_name: 'Color rods' },
];

function names(list: { name: string }[]) {
  return list.map(({ name }) => name);
}

describe('getGroupOptions', () => {
  // Otherwise the group dropdown would list a group once per supply, or out of order.
  it('offers All supplies, each group once alphabetically, then No group', () => {
    expect(getGroupOptions(supplies)).toEqual([
      { key: allSuppliesKey, label: 'All supplies' },
      { key: 'Clear tubing', label: 'Clear tubing' },
      { key: 'Color rods', label: 'Color rods' },
      { key: noGroupKey, label: 'No group' },
    ]);
  });

  // Otherwise No group would be offered when picking it could only show an empty list.
  it('leaves out No group when every supply has a group', () => {
    const grouped = supplies.filter(({ group_name }) => group_name !== null);

    expect(getGroupOptions(grouped).map(({ label }) => label)).toEqual([
      'All supplies',
      'Clear tubing',
      'Color rods',
    ]);
  });

  // Otherwise a maker with no groups would see a dropdown whose only choice is All supplies.
  it('offers nothing when no supply has a group', () => {
    expect(getGroupOptions([{ name: 'Silver bail', group_name: null }])).toEqual([]);
  });
});

describe('keepOfferedGroup', () => {
  // Otherwise coming back to the list after changing a supply would drop the filter just picked.
  it('keeps a group, or No group, that a supply is still under', () => {
    expect(keepOfferedGroup(supplies, 'Color rods')).toBe('Color rods');
    expect(keepOfferedGroup(supplies, noGroupKey)).toBe(noGroupKey);
  });

  // Otherwise the list stays empty, and with no group left the dropdown is gone too, so nothing
  // on screen can clear it.
  it('goes back to All supplies once no supply is under the chosen group', () => {
    const ungrouped = [{ name: 'Silver bail', group_name: null }];
    const allGrouped = supplies.filter(({ group_name }) => group_name !== null);

    expect(keepOfferedGroup(ungrouped, 'Color rods')).toBe(allSuppliesKey);
    expect(keepOfferedGroup(supplies, 'Frit')).toBe(allSuppliesKey);
    expect(keepOfferedGroup(allGrouped, noGroupKey)).toBe(allSuppliesKey);
  });
});

describe('filterSupplies', () => {
  // Otherwise picking a group would still scroll past every other supply.
  it('shows only the chosen group, or every supply, or those with no group', () => {
    expect(names(filterSupplies(supplies, 'Color rods', ''))).toEqual(['Amber rod', 'Cobalt rod']);
    expect(names(filterSupplies(supplies, allSuppliesKey, ''))).toEqual(names(supplies));
    expect(names(filterSupplies(supplies, noGroupKey, ''))).toEqual(['Silver bail']);
  });

  // Otherwise "cobalt " typed on the phone would miss "Cobalt rod".
  it('finds names containing the search, ignoring case and spaces around it', () => {
    expect(names(filterSupplies(supplies, allSuppliesKey, ' cobalt '))).toEqual(['Cobalt rod']);
    expect(names(filterSupplies(supplies, allSuppliesKey, 'ROD'))).toEqual([
      'Amber rod',
      'Cobalt rod',
    ]);
  });

  // Otherwise a search inside a group would reach supplies from other groups.
  it('searches only within the chosen group', () => {
    expect(names(filterSupplies(supplies, 'Clear tubing', 'rod'))).toEqual([]);
    expect(names(filterSupplies(supplies, 'Color rods', 'amber'))).toEqual(['Amber rod']);
  });
});
