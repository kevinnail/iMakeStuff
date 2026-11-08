import { router, type Href } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getGuideSeen, markGuideSeen } from '@/db/queries/settingsQueries';
import { useGuideStore, type GuideTarget } from '@/store/guideStore';
import { colors } from '@/theme';
import { showError } from '@/utils/showError';

// The tab bar's tabs, left to right.
const tabs: { name: string; route: Href }[] = [
  { name: 'Work', route: '/' },
  { name: 'Pieces', route: '/pieces' },
  { name: 'Days', route: '/days' },
];

const arrowWidth = 150;
// How far apart the tab bar's buttons are, as a share of the screen width. iOS draws the tab bar
// as a pill in the middle, narrower than the screen, and React Native can't measure it, so this is
// measured off the phone (2026-11-07).
const tabSpacing = 0.22;

// "Work tab", "Pieces tab", or "Days tab", wherever the guide's text says one.
const tabNamePattern = new RegExp(`(${tabs.map(({ name }) => `${name} tab`).join('|')})`);

// A paragraph of the guide with every tab name in bold, so where to go stands out. Splitting on
// the pattern's one group leaves the tab names at the odd places.
function GuideText({ text }: { text: string }) {
  return (
    <Text style={styles.body}>
      {text.split(tabNamePattern).map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={styles.tabName}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

// A word the app uses, in the color the app shows it in, and what it means.
interface Definition {
  term: 'Piece' | 'Prep';
  meaning: string;
}

const termColors = { Piece: colors.primary, Prep: colors.prep };

// One of the app's words, indented under the paragraph that uses it.
function DefinitionLine({ term, meaning }: Definition) {
  return (
    <Text style={[styles.body, styles.definition]}>
      <Text style={[styles.term, { color: termColors[term] }]}>{term}:</Text> {meaning}
    </Text>
  );
}

interface GuideStep {
  // The tab the step's button is on, by its place in tabs. It's opened under the guide.
  tabIndex: number;
  target: GuideTarget | null;
  title: string;
  // One string per paragraph, or a definition of one of the app's words.
  body: (string | Definition)[];
  // Shown under the paragraphs: the Quick Start map, or how a cost adds up.
  extra?: 'map' | 'diagram';
  // The panel sits away from the outlined button, and never at the bottom, where it would cover
  // the tab bar.
  panelAt: 'top' | 'middle';
}

// What to do and where, then each of those on its own tab, then what it gets you. The last step
// is on the Work tab, so the guide ends where work starts.
const guideSteps: GuideStep[] = [
  {
    tabIndex: 0,
    target: null,
    title: 'Quick Start',
    body: [
      'Keeping track of your cost per piece depends on you doing these three things, in this order:',
    ],
    extra: 'map',
    panelAt: 'middle',
  },
  {
    tabIndex: 1,
    target: 'supplies',
    title: 'Start with supplies',
    body: [
      'Add your smallest priced unit of supplies on the Pieces tab. This is your one setup step: without it, nothing can show a cost.',
      'Add what you bought and what it cost, like a $40 board, a $30 bag of clay, or a $15 tube of glass.',
    ],
    panelAt: 'middle',
  },
  {
    tabIndex: 0,
    target: 'start',
    title: 'Then time your work',
    body: [
      "This is where you'll spend most of your time, timing prep and pieces.",
      { term: 'Piece', meaning: 'your final product.' },
      { term: 'Prep', meaning: 'parts you make ahead that go into your final products.' },
      "Tap Done when it's made: that's where you add the prep and supplies it used.",
    ],
    panelAt: 'middle',
  },
  {
    tabIndex: 2,
    target: 'addWork',
    title: 'Manual Work Entry',
    body: [
      'If you forget to use the app to track your time, you can use the Add Work feature to catch up afterward here on the Days tab, with the date & times it really took.',
    ],
    panelAt: 'top',
  },
  {
    tabIndex: 0,
    target: null,
    title: 'How it adds up',
    body: ['Each one feeds the next.'],
    extra: 'diagram',
    panelAt: 'middle',
  },
];

const quickStartMap = [
  { action: 'Add your supplies', where: 'On the Pieces tab. Once, and when you buy more.' },
  { action: 'Tap Start!', where: 'On the Work tab. Every time you work.' },
  { action: "Tap Done when it's made", where: 'And add the prep and supplies it used.' },
];

// What to do, where, and how often, numbered in the order to do it.
function QuickStartMap() {
  return (
    <View style={styles.map}>
      {quickStartMap.map(({ action, where }, index) => (
        <View key={action} style={styles.mapRow}>
          <Text style={styles.mapNumber}>{index + 1}</Text>
          <View style={styles.fill}>
            <Text style={styles.mapAction}>{action}</Text>
            <GuideText text={where} />
          </View>
        </View>
      ))}
    </View>
  );
}

type Scenario = 'withSupplies' | 'noSupplies';

// The diagram's one button, under it where the question comes up: what it shows next.
const scenarioButtonLabels: Record<Scenario, string> = {
  withSupplies: 'What if I skip supplies?',
  noSupplies: 'Show it with supplies',
};

interface DiagramNode {
  name: string;
  color: string;
  // null where there's no cost to pass on, shown as No cost.
  cost: string | null;
  // Supplies take no time.
  time: string | null;
  // Per one of the prep made.
  each?: boolean;
  // Not added: drawn dashed and faded.
  missing?: boolean;
}

// One example worked through both ways, with no craft named: $40 of supplies makes 4 prep in an
// hour, and a piece takes 2 of them and 3 hours.
const diagram: Record<Scenario, { nodes: DiagramNode[]; caption: string }> = {
  withSupplies: {
    nodes: [
      { name: 'Supplies', color: colors.text, cost: '$40', time: null },
      { name: 'Prep', color: colors.prep, cost: '$10', time: '15m', each: true },
      { name: 'Piece', color: colors.primary, cost: '$20', time: '3h 30m' },
    ],
    caption: '$40 of supplies made 4 prep in an hour. A piece used 2, plus 3h of your time.',
  },
  noSupplies: {
    nodes: [
      { name: 'Supplies', color: colors.text, cost: 'None', time: null, missing: true },
      { name: 'Prep', color: colors.prep, cost: null, time: '15m', each: true },
      { name: 'Piece', color: colors.primary, cost: null, time: '3h 30m' },
    ],
    caption: 'With no supplies, nothing has a cost to pass on. Prep and pieces show only time.',
  },
};

// Each node steps down and to the right of the one before, so the chain reads as a flow.
const nodePlaces = ['flex-start', 'center', 'flex-end'] as const;
// Each arrow sits where the two nodes it joins overlap.
const arrowPlaces = [{ marginLeft: '38%' }, { marginLeft: '58%' }] as const;

// "$10 + 15m each", or "No cost, 15m each" with No cost in yellow.
function NodeValue({ cost, time, each }: DiagramNode) {
  return (
    <Text style={styles.nodeValue}>
      {cost === null ? <Text style={styles.noCost}>No cost</Text> : cost}
      {time !== null && `${cost === null ? ',' : ' +'} ${time}`}
      {each && ' each'}
    </Text>
  );
}

// Supplies feed prep, which feeds pieces, stepping down the panel in the colors the app uses for
// each. Its button switches to no supplies, showing the cost drop out of everything after it.
function CostDiagram() {
  const [scenario, setScenario] = useState<Scenario>('withSupplies');
  const { nodes, caption } = diagram[scenario];

  return (
    <View style={styles.diagram}>
      <View>
        {nodes.map((node, index) => (
          <Fragment key={node.name}>
            {index > 0 && <Text style={[styles.arrow, arrowPlaces[index - 1]]}>↓</Text>}
            <View
              style={[
                styles.node,
                { borderColor: node.color, alignSelf: nodePlaces[index] },
                node.missing && styles.missingNode,
              ]}
            >
              <Text style={[styles.nodeName, { color: node.color }]}>{node.name}</Text>
              <NodeValue {...node} />
            </View>
          </Fragment>
        ))}
      </View>
      <GuideText text={caption} />
      <Pressable
        style={({ pressed }) => [styles.scenarioButton, pressed && styles.buttonPressed]}
        onPress={() => setScenario(scenario === 'withSupplies' ? 'noSupplies' : 'withSupplies')}
      >
        <Text style={styles.scenarioButtonText}>{scenarioButtonLabels[scenario]}</Text>
      </Pressable>
    </View>
  );
}

// Points down at the tab the step is on, just above the tab bar. The tabs are centered on the
// screen, tabSpacing apart.
function TabArrow({ tabIndex }: { tabIndex: number }) {
  const tabBarHeight = useGuideStore((state) => state.tabBarHeight);
  const { width } = useWindowDimensions();
  const tabMiddle = width / 2 + (tabIndex - (tabs.length - 1) / 2) * tabSpacing * width;

  return (
    <View style={[styles.tabArrow, { bottom: tabBarHeight, left: tabMiddle - arrowWidth / 2 }]}>
      <View style={styles.tabArrowLabelBox}>
        <Text style={styles.tabArrowLabel}>{tabs[tabIndex].name} tab</Text>
      </View>
      <Text style={styles.tabArrowPoint}>↓</Text>
    </View>
  );
}

// Puts a step on screen, on its tab, with its button outlined.
function showStep(index: number) {
  useGuideStore.getState().setStep(index, guideSteps[index].target);
  router.navigate(tabs[guideSteps[index].tabIndex].route);
}

// The Work tab's ? button: the guide again from its first step, for anyone who skipped it.
export function showQuickStart() {
  showStep(0);
}

// Shown once, on first open: a few steps, each opening the tab its button is on and outlining it,
// with a panel saying what it's for and an arrow at the tab. Finishing or skipping saves it as
// seen. The Work tab's ? button shows it again.
export function FirstRunGuide() {
  const stepIndex = useGuideStore((state) => state.stepIndex);
  const setStep = useGuideStore((state) => state.setStep);
  const tabBarHeight = useGuideStore((state) => state.tabBarHeight);
  // Whether it's saved as seen: Skip the first time, since that's for good, and Close once the ?
  // button can bring it back.
  const [seen, setSeen] = useState(false);

  // The app opens on the Work tab, where the first step is.
  useEffect(() => {
    getGuideSeen()
      .then((savedSeen) => {
        setSeen(savedSeen);
        if (!savedSeen) setStep(0, guideSteps[0].target);
      })
      .catch(showError('Could not load the guide'));
  }, [setStep]);

  function close() {
    setSeen(true);
    setStep(null, null);
    router.navigate('/');
    markGuideSeen().catch(showError('Could not save the guide as seen'));
  }

  if (stepIndex === null) return null;
  const step = guideSteps[stepIndex];
  const lastStep = stepIndex === guideSteps.length - 1;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        {/* Kept above the tab bar, whose height includes the bottom of the screen. */}
        <SafeAreaView
          edges={['top']}
          style={[
            styles.panelArea,
            { paddingBottom: tabBarHeight + 16 },
            step.panelAt === 'top' ? styles.atTop : styles.atMiddle,
          ]}
        >
          <View style={styles.panel}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, styles.fill]}>{step.title}</Text>
              {!lastStep && (
                <Pressable style={styles.skipButton} onPress={close}>
                  <Text style={styles.skipButtonText}>{seen ? 'Close' : 'Skip'}</Text>
                </Pressable>
              )}
            </View>
            {/* Scrolls when it's taller than the room, like the diagram on a small phone. The
                title, Skip or Close, and the buttons stay put. */}
            <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
              {step.body.map((paragraph) =>
                typeof paragraph === 'string' ? (
                  <GuideText key={paragraph} text={paragraph} />
                ) : (
                  <DefinitionLine key={paragraph.term} {...paragraph} />
                ),
              )}
              {step.extra === 'map' && <QuickStartMap />}
              {step.extra === 'diagram' && <CostDiagram />}
            </ScrollView>
            <View style={styles.buttonRow}>
              <Text style={[styles.body, styles.fill]}>
                {stepIndex + 1} of {guideSteps.length}
              </Text>
              {stepIndex > 0 && (
                <Pressable style={styles.textButton} onPress={() => showStep(stepIndex - 1)}>
                  <Text style={styles.textButtonText}>Back</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.nextButton}
                onPress={lastStep ? close : () => showStep(stepIndex + 1)}
              >
                <Text style={styles.nextButtonText}>{lastStep ? 'Finish' : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
        {/* Only where there's a button to find on that tab. */}
        {step.target && <TabArrow tabIndex={step.tabIndex} />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Light enough that the outlined button underneath still stands out.
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  panelArea: {
    flex: 1,
    padding: 16,
  },
  atTop: {
    justifyContent: 'flex-start',
  },
  // Below the buttons near the top of Work and Pieces, and clear of the tab bar on any phone.
  atMiddle: {
    justifyContent: 'center',
  },
  // Shrinks to the room there is, and its middle scrolls.
  panel: {
    flexShrink: 1,
    padding: 16,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  panelScroll: {
    flexShrink: 1,
    flexGrow: 0,
  },
  panelContent: {
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  skipButton: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  skipButtonText: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.secondaryText,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  body: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  definition: {
    paddingLeft: 12,
  },
  term: {
    fontWeight: '700',
  },
  tabName: {
    fontWeight: '700',
    color: colors.primary,
  },
  map: {
    gap: 12,
  },
  mapRow: {
    flexDirection: 'row',
    gap: 12,
  },
  mapNumber: {
    width: 20,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.primary,
  },
  mapAction: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.text,
  },
  diagram: {
    gap: 12,
  },
  // In the No cost yellow, outlined, so it reads as something to try rather than part of the
  // diagram.
  scenarioButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 8,
  },
  scenarioButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.warning,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  arrow: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.secondaryText,
  },
  // Wide enough for its value on one line, narrow enough to step across the panel.
  node: {
    width: '60%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 2,
    borderRadius: 10,
  },
  missingNode: {
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  nodeName: {
    fontSize: 16,
    fontWeight: '600',
  },
  nodeValue: {
    fontSize: 16,
    color: colors.text,
  },
  // The yellow of the app's No cost tag.
  noCost: {
    color: colors.warning,
  },
  fill: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  textButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  nextButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  // The same yellow as the outline on the step's button.
  tabArrow: {
    position: 'absolute',
    width: arrowWidth,
    alignItems: 'center',
  },
  // On the page's color, so it reads over whatever is on the screen under it, with the same
  // yellow glow as the outline on the step's button.
  tabArrowLabelBox: {
    paddingVertical: 20,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.background,
    boxShadow: `0px 0px 16px ${colors.warning}`,
    width: arrowWidth,
  },
  tabArrowLabel: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.warning,
    textAlign: 'center',
  },
  tabArrowPoint: {
    fontSize: 32,
    lineHeight: 34,
    color: colors.warning,
    textShadowColor: colors.warning,
    textShadowRadius: 12,
  },
  nextButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
