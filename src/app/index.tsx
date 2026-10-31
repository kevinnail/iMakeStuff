import { StyleSheet, Text, View } from 'react-native';

// Placeholder until slice 1 replaces it with the Work tab.
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>iMakeStuff</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
  },
});
