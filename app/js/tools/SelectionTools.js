import toast from '../ui/toast.js';

// Multi-select tool: a selection mode where each tap adds/removes an
// object from the selection set (the tap→toggle behavior is handled in
// InteractionManager when this tool is active). It never transforms,
// so it has no drag behavior of its own.
export function makeMultiTool(){
  return {
    label:'Multi', key:'x', needsSelection:false,
    icon:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 7h6M16 4v6" stroke-linecap="round"/>',
    hint: () => 'tap objects to add or remove them from the selection',
    claim(){ return false; },   // selection is handled by tap, not a drag
    begin(){}, update(){}
  };
}

// Merge instant action: combines all selected objects into one mesh
// (world transforms baked into geometry). Appears in the More Tools…
// group and runs on tap.
export function makeMergeAction(om){
  return {
    label:'Merge', key:'j', instant:true,
    icon:'<path d="M7 4v6a5 5 0 0 0 5 5 5 5 0 0 0 5-5V4"/><path d="M12 15v5"/><path d="M9 20h6" stroke-linecap="round"/>',
    run(){
      if (om.selection.length < 2){ toast('Select 2+ objects to merge'); return; }
      const n = om.selection.length;
      om.mergeSelection();
      om.bus.emit('history:commit');
      toast(`Merged ${n} objects`);
    }
  };
}
