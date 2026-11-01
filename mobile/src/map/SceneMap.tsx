import {memo, useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {WebView} from 'react-native-webview';
import {colors} from '../styles';
import {type EstimatedPrediction} from '../shuttle/feed';
import {sceneEventSchema, sceneState, type SceneCommand} from './protocol';
import packagedScene from './scene.generated.json';

const source = {html: packagedScene.html, baseUrl: 'about:blank'};
const presets = [
  {view: 'campus', label: 'Campus'}, {view: 'route', label: 'Full route'},
  {view: 'fehren', label: 'Fehren'}, {view: 'buildings', label: 'Buildings'}, {view: 'sports', label: 'Sports'},
] satisfies {view: Extract<SceneCommand, {kind: 'camera'}>['view']; label: string}[];
type LoadState = {kind: 'loading'} | {kind: 'ready'} | {kind: 'error'; message: string};
type Props = {prediction: EstimatedPrediction | null; checkedAt: string | null; expanded: boolean; onExpand: () => void};
const glyphs = {
  plus: <Path d="M12 5v14M5 12h14"/>,
  minus: <Path d="M5 12h14"/>,
  pan: <Path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3m-3 15-3-3m3 3 3-3M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3"/>,
  orbit: <Path d="M20 12a8 8 0 1 1-2.6-5.9M20 3v4h-4"/>,
  locate: <><Circle cx={12} cy={12} r={7}/><Path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  expand: <Path d="M4 9V4h5m11 5V4h-5M4 15v5h5m11-5v5h-5"/>,
  collapse: <Path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5"/>,
};
function Glyph({kind, color = colors.ink, size = 18}: {kind: keyof typeof glyphs; color?: string; size?: number}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>{glyphs[kind]}</Svg>;
}

export const SceneMap = memo(function SceneMap({prediction, checkedAt, expanded, onExpand}: Props) {
  const web = useRef<WebView>(null);
  const [load, setLoad] = useState<LoadState>({kind: 'loading'});
  const [attempt, setAttempt] = useState(0);
  const [orbit, setOrbit] = useState(false);
  const [chosen, setChosen] = useState<string | null>('campus');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const {height, width} = useWindowDimensions();
  const showToolbarIcons = width >= 360;
  const send = useCallback((command: SceneCommand) => {
    web.current?.injectJavaScript(`window.BusTrackrScene?.receive(${JSON.stringify(command)});true;`);
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      const foreground = next === 'active';
      setActive(foreground);
      send({kind: 'state', marker: null, expiresAt: 0, active: foreground});
    });
    return () => listener.remove();
  }, [send]);
  useEffect(() => {
    if (load.kind !== 'ready') return;
    send(sceneState(prediction, checkedAt, active, Date.now()));
  }, [prediction, checkedAt, active, load.kind, send]);
  useEffect(() => {
    if (load.kind === 'ready') send({kind: 'orbit', enabled: orbit});
  }, [load.kind, orbit, send]);
  useEffect(() => {
    if (load.kind !== 'loading') return;
    const timeout = setTimeout(() => setLoad({kind: 'error', message: 'The 3D scene took too long to load.'}), 60_000);
    return () => clearTimeout(timeout);
  }, [attempt, load.kind]);
  function fail(message: string) {setLoad({kind: 'error', message});}
  const enabled = load.kind === 'ready';
  return <View style={[styles.section, expanded && styles.expanded]}>
    <View style={[styles.viewport, expanded ? styles.expanded : {height: Math.max(320, height * .48)}]}>
      <WebView key={attempt} ref={web} source={source} style={styles.web}
        originWhitelist={['*']} onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        javaScriptEnabled scrollEnabled={false} bounces={false} overScrollMode="never"
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false} mixedContentMode="never"
        onError={() => fail('The 3D map could not load.')} onContentProcessDidTerminate={() => fail('The map renderer stopped. Reload the scene.')}
        onRenderProcessGone={() => fail('The map renderer stopped. Reload the scene.')}
        onMessage={event => {
          try {
            const input: unknown = JSON.parse(event.nativeEvent.data);
            const parsed = sceneEventSchema.safeParse(input);
            if (!parsed.success) return;
            if (parsed.data.kind === 'ready') setLoad({kind: 'ready'});
            else fail(parsed.data.message);
          } catch {fail('The map returned an invalid response.');}
        }}/>
      {load.kind !== 'ready' && <View style={styles.loading}>
        {load.kind === 'loading' ? <><ActivityIndicator color={colors.teal}/><Text style={styles.loadingTitle}>Building your 3D campus</Text><Text style={styles.note}>Loading the bundled terrain, buildings and route.</Text></> : <>
          <Text style={styles.loadingTitle}>3D map unavailable</Text><Text style={styles.note}>{load.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => {setLoad({kind: 'loading'}); setChosen('campus'); setAttempt(value => value + 1);}} style={styles.control}><Text style={styles.controlText}>Reload 3D map</Text></Pressable>
        </>}
      </View>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets} contentContainerStyle={styles.presetRow}>
        {presets.map(preset => {
          const selected = chosen === preset.view;
          return <Pressable key={preset.view} accessibilityRole="button" accessibilityLabel={`3D view: ${preset.label}`} accessibilityState={{selected, disabled: !enabled}} disabled={!enabled} onPress={() => {setChosen(preset.view); send({kind: 'camera', view: preset.view});}} style={({pressed}) => [styles.chip, selected && styles.chipSelected, !enabled && styles.disabled, pressed && styles.pressed]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.controlText, selected && styles.chipTextSelected]}>{preset.label}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <View style={[styles.zoom, !enabled && styles.disabled]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom into 3D map" accessibilityState={{disabled: !enabled}} disabled={!enabled} onPress={() => send({kind: 'zoom', factor: .75})} style={({pressed}) => [styles.zoomButton, pressed && styles.pressed]}><Glyph kind="plus" size={20}/></Pressable>
        <View style={styles.zoomRule}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out of 3D map" accessibilityState={{disabled: !enabled}} disabled={!enabled} onPress={() => send({kind: 'zoom', factor: 1.25})} style={({pressed}) => [styles.zoomButton, pressed && styles.pressed]}><Glyph kind="minus" size={20}/></Pressable>
      </View>
      <View pointerEvents="box-none" style={styles.bottom}>
        <View pointerEvents="none" style={styles.mapLabel}>
          <View style={[styles.mapLabelDot, prediction ? styles.mapLabelDotEstimate : styles.mapLabelDotEmpty]}/>
          <Text maxFontSizeMultiplier={1.3} style={styles.mapLabelText}>{prediction ? 'AMBER = ESTIMATE · NOT GPS' : 'NO POSITION ESTIMATE'}</Text>
        </View>
        <View pointerEvents="box-none" style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel={orbit ? 'Switch map to pan' : 'Switch map to orbit'} accessibilityState={{selected: orbit, disabled: !enabled}} disabled={!enabled} onPress={() => setOrbit(value => !value)} style={({pressed}) => [styles.control, !enabled && styles.disabled, pressed && styles.pressed]}>
            <Glyph kind={orbit ? 'orbit' : 'pan'}/><Text maxFontSizeMultiplier={1.3} style={styles.controlText}>{orbit ? 'Orbit' : 'Pan'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Locate estimate on 3D map" accessibilityState={{disabled: !enabled || !prediction}} disabled={!enabled || !prediction} onPress={() => {setChosen(null); send({kind: 'camera', view: 'estimate'});}} style={({pressed}) => [styles.control, styles.shrink, (!enabled || !prediction) && styles.disabled, pressed && styles.pressed]}>
            {showToolbarIcons && <Glyph kind="locate" color={colors.amber}/>}<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} maxFontSizeMultiplier={1.3} style={[styles.controlText, styles.shrink]}>Locate estimate</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onExpand} style={({pressed}) => [styles.control, styles.shrink, pressed && styles.pressed]}>
            {showToolbarIcons && <Glyph kind={expanded ? 'collapse' : 'expand'}/>}<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} maxFontSizeMultiplier={1.3} style={[styles.controlText, styles.shrink]}>{expanded ? 'Show details' : 'Expand map'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
    <Text style={styles.attribution}>© OpenStreetMap contributors · USGS terrain · Modeled scenery</Text>
  </View>;
});
const floating = {backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: '0 1px 4px rgba(18, 22, 27, .16)'};
const styles = StyleSheet.create({
  section: {backgroundColor: colors.paper}, expanded: {flex: 1},
  viewport: {backgroundColor: '#d9e1db'}, web: {flex: 1, backgroundColor: '#d9e1db'},
  presets: {position: 'absolute', top: 0, left: 0, right: 0, flexGrow: 0},
  presetRow: {gap: 6, padding: 10},
  chip: {...floating, minHeight: 44, minWidth: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 22},
  chipSelected: {backgroundColor: colors.ink, borderColor: colors.ink},
  chipTextSelected: {color: colors.card},
  control: {...floating, minHeight: 44, minWidth: 44, paddingHorizontal: 11, flexDirection: 'row', gap: 5, justifyContent: 'center', alignItems: 'center', borderRadius: 12},
  controlText: {fontSize: 13, fontWeight: '600', color: colors.ink},
  shrink: {flexShrink: 1},
  disabled: {opacity: .45}, pressed: {opacity: .6},
  zoom: {...floating, position: 'absolute', right: 10, top: 64, borderRadius: 12},
  zoomButton: {width: 44, height: 44, justifyContent: 'center', alignItems: 'center'},
  zoomRule: {height: StyleSheet.hairlineWidth, backgroundColor: colors.line},
  bottom: {position: 'absolute', left: 10, right: 10, bottom: 10, gap: 8},
  toolbar: {flexDirection: 'row', gap: 6, justifyContent: 'space-between'},
  mapLabel: {...floating, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8},
  mapLabelDot: {width: 8, height: 8, borderRadius: 4},
  mapLabelDotEstimate: {backgroundColor: colors.amber},
  mapLabelDotEmpty: {borderWidth: 1.5, borderColor: colors.muted},
  mapLabelText: {fontSize: 11, fontWeight: '700', letterSpacing: .4, color: colors.ink},
  attribution: {fontSize: 10, color: colors.muted, paddingHorizontal: 16, paddingVertical: 4},
  loading: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 112, gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.paper},
  loadingTitle: {fontSize: 17, fontWeight: '600', color: colors.ink}, note: {fontSize: 13, color: colors.muted, textAlign: 'center'},
});
