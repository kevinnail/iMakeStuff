import { StyleSheet, TextInput, View } from 'react-native';

import { Dropdown } from '@/components/Dropdown';
import { colors } from '@/theme';
import { getGroupOptions, type GroupKey } from '@/utils/supplyFilter';

interface SupplyFilterProps {
  supplies: { name: string; group_name?: string | null }[];
  groupKey: GroupKey;
  onChangeGroup: (groupKey: GroupKey) => void;
  searchText: string;
  onChangeSearch: (searchText: string) => void;
}

// Narrows a long list of supplies: a group dropdown, shown once any supply has a group, and a
// search box for the name.
export function SupplyFilter({
  supplies,
  groupKey,
  onChangeGroup,
  searchText,
  onChangeSearch,
}: SupplyFilterProps) {
  const groupOptions = getGroupOptions(supplies);

  return (
    <View style={styles.filter}>
      {groupOptions.length > 0 && (
        <Dropdown
          options={groupOptions}
          selectedKey={groupKey}
          placeholder="All supplies"
          onSelect={(option) => onChangeGroup(option.key)}
          floating
        />
      )}
      <TextInput
        style={styles.search}
        value={searchText}
        onChangeText={onChangeSearch}
        placeholder="Search supplies"
        placeholderTextColor={colors.secondaryText}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filter: {
    gap: 8,
  },
  search: {
    fontSize: 18,
    padding: 8,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
});
