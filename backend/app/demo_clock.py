"""One persistent clock per shared demo run; reads never reset its anchor."""
import time
import uuid

def wall_ms():
    return int(time.time()*1000)

def start(state, wall=None):
    wall=wall_ms() if wall is None else wall
    state['demoClock']={'runId':str(uuid.uuid4()),'base':int(state['now']),'anchor':wall,'rate':1}

def advance(state, wall=None):
    wall=wall_ms() if wall is None else wall
    if not state.get('demoClock'):start(state,wall)
    clock=state['demoClock']
    state['now']=max(int(state['now']),clock['base']+max(0,wall-clock['anchor']))
    return state['now']

def jump(state, delta, wall=None):
    wall=wall_ms() if wall is None else wall
    advance(state,wall)
    state['now']+=delta
    state['demoClock'].update(base=state['now'],anchor=wall)
