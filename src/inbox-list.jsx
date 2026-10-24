import React from 'react';
import {ChevronRight} from 'lucide-react';
import {originalWording,aiSuggestionCount} from './core.js';

export function InboxList({cards,selection,onSelect,hasIdeas}){
  if(!cards.length)return <p className="inbox-list-empty">{hasIdeas?'No inbox ideas match your search.':'Speak or type a thought. Each distinct idea appears here and as a card beside it.'}</p>;
  return <ol className="idea-list" aria-label="Inbox ideas">
    {cards.map((card,index)=><li key={card.id} data-testid="inbox-idea" data-idea-id={card.id}>
      <button className={`idea-list-entry ${selection.includes(card.id)?'selected':''}`} aria-label={`Show card: ${card.title}`} aria-pressed={selection.includes(card.id)} onClick={e=>onSelect(e,card.id)}>
        <span className={`idea-list-number ${card.color}`}>{index+1}</span>
        <span className="idea-list-content"><span className="origin-badge captured">Your captured {card.kind==='task'?'task':'idea'}</span><strong>{card.title}</strong><span className="wording-label">Original wording</span><span className="idea-list-source">{originalWording(card)}</span><small>{card.kind==='task'?(card.done?'Completed task':'Task'):'Idea'}{card.priority==='High'?' / High priority':''} / {card.notes.length} {card.notes.length===1?'note':'notes'}{card.source!==originalWording(card)?' / Corrected':''}</small>{aiSuggestionCount(card)>0&&<span className="origin-badge ai">AI suggestions: {aiSuggestionCount(card)}</span>}</span>
        <ChevronRight size={13}/>
      </button>
    </li>)}
  </ol>;
}
