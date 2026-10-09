import json,statistics,subprocess
from pathlib import Path
from urllib.parse import urlsplit
R=Path('/tmp/wwm-home-performance-20261009')
def read(directory,file):
 p=R/directory/file
 return json.loads(p.read_text()) if p.exists() else None
def stats(xs):
 xs=sorted(x for x in xs if isinstance(x,(int,float)))
 return {'n':len(xs),'median':statistics.median(xs),'min':xs[0],'max':xs[-1],'trials':xs} if xs else {'n':0}
def groups(a):
 return sorted(set(r['spec']['name'] for r in a['runs']))
def select(a,name):return [r for r in a['runs'] if r['spec']['name']==name]
B=read('baseline-fixed','runtime.json');C=read('candidate-final','runtime.json')
S={'measuredCandidate':read('candidate-final-dist','performance-build.json'),'baselineBuild':read('baseline-dist','performance-build.json')}
S['graphics']=[]
for name in ['home-auto-dpr2','home-low-dpr2','home-auto-dpr1','home-auto-cpu6-dpr2']:
 row={'case':name}
 for arm,a in [('baseline',B),('candidate',C)]:
  if a:
   xs=select(a,name);row[arm]={k:stats(v) for k,v in {
    'gpuP50Ms':[r['gpuMs'].get('p50') for r in xs],
    'trackedMiB':[(r['after'].get('totalTrackedBytes') or r['after']['rendererMemory']['total'])/1048576 for r in xs],
    'busyPct':[r['mainThreadBusyPct'] for r in xs],
    'sceneFps':[r['sceneFps'] for r in xs],
    'drawCalls':[r['after']['stats']['drawCalls'] for r in xs],
    'pixels':[r['after']['canvas']['width']*r['after']['canvas']['height'] for r in xs],
    'rafP50Ms':[r['rafIntervalMs']['p50'] for r in xs]}.items()}
 S['graphics'].append(row)
S['loading']=[]
for name in ['desktop-native','desktop-cpu6-10Mbps','mobile-cpu6-1.6Mbps']:
 for cache in ['cold','warm']:
  row={'case':name,'cache':cache}
  for arm,d in [('baseline','baseline-fixed'),('candidate','candidate-final')]:
   a=read(d,'startup.json')
   if a:
    xs=[r for r in select(a,name) if r['cache']==cache]
    row[arm]={k:stats(v) for k,v in {
     'startAvailableMs':[r['probe']['startAt'] for r in xs],
     'lcpMs':[r['probe']['lcp'][-1]['at'] for r in xs],
     'fcpMs':[next(p['at'] for p in r['probe']['paint'] if p['name']=='first-contentful-paint') for r in xs],
     'shellJsKiB':[sum(e['encodedBodySize'] for e in r['resources'] if urlsplit(e['name']).path.endswith('.js') and e['startTime']<=r['probe']['startAt'])/1024 for r in xs],
     'preparedMainJsKiB':[sum(e['encodedBodySize'] for e in r['resources'] if urlsplit(e['name']).path.endswith('.js'))/1024 for r in xs],
     'attractReadyMs':[r['probe']['attractReadyAt'] for r in xs]}.items()}
  S['loading'].append(row)
S['control']=[]
for name in ['desktop-native','desktop-cpu6-10Mbps','mobile-cpu6-1.6Mbps']:
 row={'case':name}
 for arm,d in [('baseline','baseline-control-refresh'),('candidate','candidate-final')]:
  a=read(d,'start-control.json')
  if a:
   xs=select(a,name);row[arm]={k:stats(v) for k,v in {
    'navigationToPlayMs':[r['navigationToPlayMs'] for r in xs],
    'startToPlayMs':[r['startToPlayMs'] for r in xs],
    'gestureToFeedbackRafMs':[r['feedbackFrameMs'] for r in xs],
    'sampledPeakMiB':[r['sampledPeakBytes']/1048576 for r in xs],
    'initialTier':[r['probe']['initialTier'] for r in xs],
    'maxWrittenPixels':[max(p['width']*p['height'] for p in r['probe']['dimensions']) for r in xs]}.items()}
   row[arm]['allReceivedPowerJumpTilt']=all(r['control'] for r in xs)
 S['control'].append(row)
S['idle']=[]
for name in ['home-cached-dpr2','home-ambient10-dpr2','home-ambient15-dpr2','home-auto-dpr2']:
 row={'case':name}
 for window,d in [('short3','candidate-final'),('long60','candidate-idle60')]:
  a=read(d,'runtime.json')
  if a:
   xs=select(a,name);row[window]={k:stats(v) for k,v in {
    'sceneFrames':[r['sceneFrames'] for r in xs], 'sceneFps':[r['sceneFps'] for r in xs],
    'busyPct':[r['mainThreadBusyPct'] for r in xs], 'gpuP50Ms':[r['gpuMs'].get('p50') for r in xs],
    'wakeP95Ms':[r.get('wake',{}).get('p95') for r in xs],
    'elapsedMs':[r['elapsedMs'] for r in xs],
    'rafP50Ms':[r['rafIntervalMs']['p50'] for r in xs]}.items()}
 S['idle'].append(row)
S['play']=[]
for name in ['play-auto-native','play-low-native','play-auto-cpu6','play-low-cpu6']:
 row={'case':name}
 for arm,d in [('baseline','baseline-fixed'),('candidate','candidate-final')]:
  a=read(d,'play.json')
  if a:
   xs=select(a,name);row[arm]={k:stats(v) for k,v in {
    'frameP95Ms':[r['frame']['p95'] for r in xs],'frameP99Ms':[r['frame']['p99'] for r in xs],
    'frameMaxMs':[r['frame']['max'] for r in xs],'busyPct':[r['mainThreadBusyPct'] for r in xs],
    'pauseToRafMs':[r['pauseInput']['nextFrame']-r['pauseInput']['at'] for r in xs if r.get('pauseInput')],
    'resumeToRafMs':[r['resumeInput']['nextFrame']-r['resumeInput']['at'] for r in xs if r.get('resumeInput')]}.items()}
 S['play'].append(row)
a=read('candidate-final-recovery','play.json')
S['recovery']=[] if not a else [{
 'trial':r['repeat'],'frame':r['frame'],'cpu':r['engineCpuMs'],
 'longTasks':r['raw']['long'],'tierLog':r['state']['engine']['tierLog'],
 'firstKey':r['raw']['inputs'][0], 'elapsedMs':r['elapsedMs']} for r in a['runs']]
for arm in ['baseline','candidate']:
 a=read(arm+'-lighthouse','lighthouse-summary.json')
 S[arm+'Lighthouse']=a
S['comparator']=read('','comparison.json')
(R/'summary-final.json').write_text(json.dumps(S,indent=2)+'\n')
print('Wrote current summary with all per-trial values; completion checked separately.')
