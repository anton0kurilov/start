import test from 'node:test'
import assert from 'node:assert/strict'
import {createReadingPosition} from '../../src/app/reading.ts'
function harness(auto=false) {
    const cards=[]
    const column={scrollTop:0,getBoundingClientRect:()=>({top:0}),scrollTo({top}){this.scrollTop=top}}
    const content={scrollTop:0,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>cards,scrollTo({top}){this.scrollTop=top}}
    let visible=false
    const marks=[]
    function card(id) {const el={dataset:{itemKey:id,cardKey:id},visited:false,classList:{contains:()=>el.visited},getBoundingClientRect:()=>({top:cards.indexOf(el)*100-content.scrollTop-column.scrollTop,bottom:(cards.indexOf(el)+1)*100-content.scrollTop-column.scrollTop})};return el}
    cards.push(...Array.from({length:15},(_,i)=>card(`item-${i}`)))
    const reading=createReadingPosition(column,content,v=>visible=v,keys=>marks.push(...keys),()=>auto)
    return {cards,column,content,card,reading,marks,visible:()=>visible}
}
test('reading retains the same anchor and detects new arrivals above',()=>{
    const h=harness();h.content.scrollTop=450;h.reading.scroll();h.reading.capture()
    h.cards.unshift(h.card('new-1'),h.card('new-2'))
    h.reading.restore()
    assert.equal(h.content.scrollTop,650)
    assert.equal(h.visible(),true)
})
test('reading at top does not show the arrivals notice',()=>{
    const h=harness();h.reading.capture();h.cards.unshift(h.card('new'));h.reading.restore();assert.equal(h.visible(),false)
})
test('arrivals below the viewport do not show the notice',()=>{
    const h=harness();h.content.scrollTop=450;h.reading.scroll();h.reading.capture();h.cards.push(h.card('new'));h.reading.restore();assert.equal(h.visible(),false)
})
test('fallback keeps offsets when the anchor disappears',()=>{
    const h=harness();h.content.scrollTop=450;h.reading.scroll();h.reading.capture();h.cards.splice(4,1);h.reading.restore();assert.equal(h.content.scrollTop,450)
})
test('only downward crossing of the top edge counts as read',()=>{
    const h=harness(true);h.content.scrollTop=250;h.reading.scroll();assert.deepEqual(h.marks,['item-0','item-1']);h.content.scrollTop=100;h.reading.scroll();assert.deepEqual(h.marks,['item-0','item-1'])
})
test('restoration suppresses auto read and establishes a new baseline',()=>{
    const h=harness(true);h.content.scrollTop=450;h.reading.baseline();h.reading.capture();h.cards.unshift(h.card('new'));h.reading.restore();h.content.scrollTop+=50;h.reading.scroll();assert.deepEqual(h.marks,[])
})
test('read or removed arrivals clear the notice',()=>{
    const h=harness();h.content.scrollTop=450;h.reading.scroll();h.reading.capture();const n=h.card('new');h.cards.unshift(n);h.reading.restore();assert.equal(h.visible(),true);n.visited=true;h.reading.scroll();assert.equal(h.visible(),false)
})
test('scroll-to-top clears notice without marking cards',t=>{
    const old=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});t.after(()=>globalThis.matchMedia=old)
    const h=harness(true);h.content.scrollTop=450;h.reading.baseline();h.reading.toTop();h.reading.scroll();assert.equal(h.content.scrollTop,0);assert.deepEqual(h.marks,[])
})
