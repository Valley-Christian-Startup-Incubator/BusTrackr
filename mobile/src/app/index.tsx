import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import {pacificTime, parseEndpoint} from '../shuttle/feed';
import {defaultSource, loadSource, saveSource} from '../shuttle/settings';
import {scenarios, type Source} from '../shuttle/samples';
import {useShuttle} from '../shuttle/useShuttle';
import {colors, styles as s} from '../styles';
import {SceneMap} from '../map/SceneMap';

const messages = {
  loading: {title: 'Checking the feed', body: 'Looking for the latest camera observation.'},
  unavailable: {title: 'Feed unavailable', body: 'Arrival and position estimates are hidden until the status service responds.'},
  stale: {title: 'Waiting for fresh data', body: 'The last update is too old to use, so estimates are hidden.'},
  unconfigured: {title: 'No confirmed timetable', body: 'Estimates stay off until an operator confirms the timetable and checkpoint direction.'},
  ambiguous: {title: 'No clear run match', body: 'More than one run could match, so no arrival or vehicle position is shown.'},
  unknown: {title: 'No active run confirmed', body: 'A missing estimate does not mean the shuttle has arrived or been cancelled.'},
  scheduled: {title: 'Waiting for the next run', body: 'This is a timetable time, not an observed arrival.'},
};
function ageLabel(minutes: number) {
  if (minutes < 0) return 'Camera clock is ahead';
  if (minutes === 0) return 'Less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
function Icon({kind, color = colors.ink, size = 24}: {kind: 'bus' | 'camera' | 'settings' | 'refresh'; color?: string; size?: number}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
    {kind === 'bus' ? <><Rect x={5} y={3} width={14} height={16} rx={3}/><Path d="M5 11h14M8 19v2m8-2v2M8 15h1m6 0h1M9 6h6"/></> :
      kind === 'camera' ? <><Rect x={3} y={7} width={18} height={13} rx={3}/><Circle cx={12} cy={13} r={3}/><Path d="m7 7 2-4h6l2 4"/></> :
        kind === 'refresh' ? <Path d="M20 12a8 8 0 1 1-2.6-5.9M20 3v4h-4"/> :
          <><Path d="M4 7h16M4 17h16"/><Circle cx={9} cy={7} r={2.4} fill={colors.card}/><Circle cx={15} cy={17} r={2.4} fill={colors.card}/></>}
  </Svg>;
}
function Button({label, onPress, secondary = false}: {label: string; onPress: () => void; secondary?: boolean}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed}) => [s.button, secondary && s.secondaryButton, pressed && s.pressed]}>
    <Text style={[s.buttonText, secondary && s.secondaryButtonText]}>{label}</Text>
  </Pressable>;
}
function Fact({label, value}: {label: string; value: string}) {
  return <View style={s.fact}><Text style={s.factLabel}>{label}</Text><Text style={s.factValue}>{value}</Text></View>;
}
function ShuttleScreen({source, changeSource, settingsError}: {source: Source; changeSource: (source: Source) => void; settingsError: string}) {
  const {view, feed, now, refresh} = useShuttle(source);
  const [settings, setSettings] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [endpoint, setEndpoint] = useState(source.kind === 'api' ? source.endpoint : '');
  const [inputError, setInputError] = useState('');
  const toggleMap = useCallback(() => setMapExpanded(value => !value), []);
  const sample = source.kind === 'sample' || feed?.status === 'sample';
  const observation = feed?.latest;
  const status = view.kind === 'loading' ? 'Checking feed' : view.kind === 'unavailable' ? 'Feed unavailable' : view.kind === 'stale' ? 'Feed is stale' : sample ? 'Illustrative data' : 'Feed connected';
  const statusColor = view.kind === 'loading' ? colors.muted : view.kind === 'unavailable' || view.kind === 'stale' ? colors.error : sample ? colors.amber : colors.teal;
  function connect() {
    try {
      const next = parseEndpoint(endpoint, __DEV__);
      changeSource({kind: 'api', endpoint: next});
      setInputError(''); setSettings(false);
    } catch (error) {setInputError(error instanceof Error ? error.message : 'Check the status URL.');}
  }
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}>
    <View style={s.header}>
      <View style={s.brand}><View style={s.brandIcon}><Icon kind="bus" color={colors.card} size={22}/></View><View style={s.brandText}><Text style={s.wordmark}>BusTrackr</Text><Text style={s.caption}>Fehren ↔ Skyway</Text></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Connection settings" onPress={() => setSettings(true)} style={({pressed}) => [s.iconButton, pressed && s.pressed]}><Icon kind="settings" size={22}/></Pressable>
    </View>
    {sample && <View style={s.sampleBanner}><Text style={s.sampleBannerText}>SAMPLE DATA · NOT A REAL SHUTTLE</Text><Pressable accessibilityRole="button" onPress={() => setSettings(true)} style={s.bannerButton}><Text style={s.sampleLink}>Connect feed</Text></Pressable></View>}
    <SceneMap prediction={view.kind === 'estimated' ? view.prediction : null} checkedAt={feed?.lastCheckedAt ?? null} expanded={mapExpanded} onExpand={toggleMap}/>
    <ScrollView style={mapExpanded ? {display: 'none'} : s.flex} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.teal}/> }>
      <View style={s.row}>
        <View style={s.statusRow}><View style={[s.statusDot, {backgroundColor: statusColor}]}/><Text accessibilityLiveRegion="polite" style={s.statusText}>{status}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh feed" onPress={refresh} style={({pressed}) => [s.refreshButton, pressed && s.pressed]}><Icon kind="refresh" color={colors.teal} size={16}/><Text style={s.refreshText}>Refresh</Text></Pressable>
      </View>
      {!!settingsError && <Text accessibilityRole="alert" style={s.error}>{settingsError}</Text>}
      <View style={s.card}>
        <View style={s.row}><View style={s.statusRow}><View style={s.estimateDot}/><Text style={[s.eyebrow, s.amber]}>ARRIVAL ESTIMATE</Text></View>{sample && <Text style={s.sampleTag}>SAMPLE</Text>}</View>
        {view.kind === 'estimated' ? <>
          <View style={s.estimateHead}>
            <Text accessibilityLabel={`Estimated arrival in ${view.rangeMinutes[0]} to ${view.rangeMinutes[1]} minutes`} style={s.range} maxFontSizeMultiplier={1.5}>{view.rangeMinutes[0]}–{view.rangeMinutes[1]} <Text style={s.minutes}>min</Text></Text>
            <View style={s.destinationBlock}><Text style={s.destination}>To {view.prediction.direction === 'inbound' ? 'campus' : 'Fehren'}</Text><Text style={s.caption}>Approximate range</Text></View>
          </View>
          <View style={s.facts}>
            <Fact label="Based on" value={view.prediction.anchor === 'camera' ? 'Camera sighting and timetable' : 'Timetable and recent delays'}/>
            <Fact label="Accuracy" value={`Heuristic, not calibrated · ${view.prediction.historyCount} historical ${view.prediction.historyCount === 1 ? 'run' : 'runs'}`}/>
            <Fact label="Calculated" value={pacificTime(view.prediction.generatedAt)}/>
          </View>
        </> : <>
          <View style={s.stateHead}>
            {view.kind === 'loading' && <ActivityIndicator color={colors.teal}/>}
            <Text accessibilityRole="header" style={s.stateTitle}>{messages[view.kind].title}</Text>
          </View>
          <Text style={s.body}>{messages[view.kind].body}</Text>
          {view.kind === 'scheduled' && view.nextCrossingAt && <View style={s.facts}><Fact label="Scheduled" value={`Checkpoint crossing ${pacificTime(view.nextCrossingAt)}`}/></View>}
          {(view.kind === 'unavailable' || view.kind === 'stale') && <View style={s.startAligned}><Button label="Try again" onPress={refresh} secondary/></View>}
        </>}
      </View>
      <View style={[s.card, s.observedCard]}>
        <View style={s.row}><View style={s.statusRow}><Icon kind="camera" color={colors.teal} size={16}/><Text style={[s.eyebrow, s.teal]}>LAST OBSERVATION</Text></View>{sample && <Text style={s.sampleTag}>SAMPLE</Text>}</View>
        <View style={s.observedHead}>
          <Text style={s.observedTitle}>{observation ? observation.checkpoint : feed ? 'No camera observations yet' : 'No observation available'}</Text>
          {observation?.eventAt && <Text style={s.observationAge}>{ageLabel(Math.floor((now - Date.parse(observation.eventAt)) / 60_000))}</Text>}
        </View>
        {observation && <Text style={s.observationTime}>{observation.eventAt ? pacificTime(observation.eventAt) : 'Camera time unavailable'}</Text>}
        <Text style={s.caption}>{observation ? 'A vehicle was detected. This does not identify the shuttle, its direction, or whether it has left.' : 'Sightings appear here when received. An empty feed does not imply an arrival.'}</Text>
        {observation && !observation.eventAt && <Text style={s.caption}>Email received {pacificTime(observation.receivedAt)}. Delivery time is not camera time.</Text>}
      </View>
      <View style={s.footer}>
        <Text style={s.caption}>{feed?.lastCheckedAt ? `Feed checked ${pacificTime(feed.lastCheckedAt)}` : 'No successful feed check yet'}</Text>
        <Text style={s.caption}>{feed ? `${feed.eventCount} camera ${feed.eventCount === 1 ? 'email' : 'emails'} saved` : 'Observation history unavailable'} · Times shown in Pacific time</Text>
      </View>
      {source.kind === 'sample' && <View style={s.card}>
        <Text style={s.eyebrow}>EXPLORE SAMPLE STATES</Text>
        <Text style={s.caption}>Illustrative scenarios. Not connected to a feed.</Text>
        <View style={s.choices}>{scenarios.map(scenario => <Pressable key={scenario.id} accessibilityRole="button" accessibilityState={{selected: source.scenario === scenario.id}} onPress={() => changeSource({kind: 'sample', scenario: scenario.id})} style={[s.choice, source.scenario === scenario.id && s.choiceSelected]}><Text style={[s.choiceText, source.scenario === scenario.id && s.choiceTextSelected]}>{scenario.label}</Text></Pressable>)}</View>
      </View>}
    </ScrollView>
    <Modal visible={settings} animationType="slide" onRequestClose={() => setSettings(false)}>
      <SafeAreaView style={s.page}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}><Text style={s.wordmark}>Connection</Text><Button label="Done" onPress={() => setSettings(false)} secondary/></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetContent}>
            <Text accessibilityRole="header" style={s.sheetTitle}>Your shuttle feed</Text>
            <Text style={s.body}>Connect the status service supplied by your shuttle operator. This app never asks for an email or camera login.</Text>
            <Text style={s.inputLabel}>Status API URL</Text>
            <TextInput accessibilityLabel="Status API URL" value={endpoint} onChangeText={setEndpoint} placeholder="https://feed.example.org/api/shuttle" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" returnKeyType="go" onSubmitEditing={connect} style={s.input}/>
            <Text style={s.caption}>Use HTTPS. On a physical phone, localhost means the phone itself.</Text>
            {__DEV__ && <Text style={s.caption}>Development builds also accept a local network HTTP address.</Text>}
            {!!inputError && <Text accessibilityRole="alert" style={s.error}>{inputError}</Text>}
            <Button label="Connect to feed" onPress={connect}/>
            <Button label="Use sample data" secondary onPress={() => {changeSource(defaultSource); setSettings(false); setInputError('');}}/>
            <View style={s.rule}/>
            <Text style={s.eyebrow}>ABOUT THE DATA</Text>
            <Text style={s.body}>Camera sightings are observations at one checkpoint. Arrival ranges and the amber 3D route marker are model estimates, not GPS.</Text>
            <Text style={s.body}>An unconfirmed timetable, ambiguous run, stale update or unavailable feed hides all estimates. No camera sighting proves a subsequent departure.</Text>
            <Text style={s.caption}>Only the status URL and sample selection are stored on this device. No location permission is needed.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
export default function Home() {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    loadSource().then(value => {if (!disposed) setSource(value);}).catch(() => {
      if (!disposed) {setSource(defaultSource); setError('Could not restore connection settings. Showing sample data.');}
    });
    return () => {disposed = true;};
  }, []);
  function changeSource(next: Source) {
    setSource(next); setError('');
    void saveSource(next).catch(() => setError('This selection works now, but could not be saved on this device.'));
  }
  if (!source) return <SafeAreaView style={[s.page, s.startup]}><ActivityIndicator color={colors.teal}/><Text style={s.body}>Opening BusTrackr…</Text></SafeAreaView>;
  return <ShuttleScreen source={source} changeSource={changeSource} settingsError={error}/>;
}
