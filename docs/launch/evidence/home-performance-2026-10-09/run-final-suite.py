import os, subprocess, time
from pathlib import Path
root=Path('/tmp/wwm-home-performance-20261009')
base={'AUDIT_BASE':'http://127.0.0.1:4318','AUDIT_BASELINE_RECORD':str(root/'baseline-dist/performance-build.json')}
cand={'AUDIT_BASE':'http://127.0.0.1:4328'}
steps=[
 ('candidate','home-start-control',cand,{},'candidate-final'),
 ('candidate','home-play',cand,{'AUDIT_SECONDS':'60','AUDIT_CASES':'play-auto-cpu6','AUDIT_REPEATS':'3'},'candidate-final-recovery'),
 ('candidate','home-startup',cand,{},'candidate-final'),
 ('candidate','home-runtime',cand,{'AUDIT_CASES':'home-cached-dpr2,home-ambient10-dpr2,home-ambient15-dpr2,home-auto-dpr2,home-low-dpr2,home-auto-dpr1,home-auto-cpu6-dpr2'},'candidate-final'),
 ('candidate','home-play',cand,{},'candidate-final'),
 ('baseline','home-start-control',base,{},'baseline-control-refresh'),
 ('candidate','home-runtime',cand,{'AUDIT_SECONDS':'60','AUDIT_REPEATS':'1','AUDIT_CASES':'home-cached-dpr2,home-ambient10-dpr2,home-ambient15-dpr2,home-auto-dpr2'},'candidate-idle60'),
]
for mode in ['gpu','frames','lifecycle','replay']:
 for arm,env in ([('baseline',base),('candidate',cand)] if mode in ['gpu','lifecycle'] else [('candidate',cand),('baseline',base)]):
  steps.append((arm,'audit-2026-09',env,{'AUDIT_TOUR_SECONDS':'60'} if mode=='frames' else {},arm+'-core',mode))
for arm,env in [('candidate',cand),('baseline',base)]:
 steps.append((arm,'home-lighthouse',env,{},arm+'-lighthouse'))
for i,step in enumerate(steps):
 arm,script,env,extra,out,*args=step
 label=f'{i+1:02d}-{arm}-{script}'+('-'+args[0] if args else '')
 print(f'START {label} {time.strftime("%H:%M:%S")}',flush=True)
 with (root/(label+'.log')).open('w') as log:
  result=subprocess.run(['node',f'infra/perf/{script}.mjs',*args],env={**os.environ,**env,**extra,'AUDIT_OUT':str(root/out)},stdout=log,stderr=subprocess.STDOUT)
 print(f'END {label} exit={result.returncode} {time.strftime("%H:%M:%S")}',flush=True)
 if result.returncode: print('STOP failure; inspect '+str(root/(label+'.log')),flush=True);break
