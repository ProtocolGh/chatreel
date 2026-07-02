import { useFonts } from 'expo-font';
import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';

/** Preload vector icon fonts on web so tab/icons do not flash in late. */
export function useWebIconFonts(): boolean {
  const [loaded] = useFonts({
    ...Ionicons.font,
    ...MaterialIcons.font,
    ...Feather.font,
  });
  return loaded;
}
