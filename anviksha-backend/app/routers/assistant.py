"""The assistant, for every role: streamed replies and saved conversations.
A conversation belongs to the user who started it and to nobody else."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assistant
from app.core.database import get_db
from app.core.security import get_current_user, normalize_role
from app.models.models import AssistantConversation, AssistantMessage, User

router = APIRouter(prefix="/assistant", tags=["assistant"])

MAX_MESSAGE = 4000
STARTERS = {
    "student": ["How am I doing academically this semester?", "What deadlines do I have coming up?", "How can I raise my profile score?",
                "What is my placement status?", "How does my batch's placement look so far?"],
    "teacher": ["Which of my students need support?", "Summarise my student feedback", "What have I posted to my classes recently?",
                "Which of my students are placed?", "Suggest five Apply-level questions on a topic I name"],
    "hod": ["Compare placement across batches", "Which students are at risk in the 2023 batch?", "How does faculty feedback compare?",
            "Who got placed at Mindsprint?", "Draft a circular about internal assessment dates"],
    "admin": ["Give me a platform overview", "What happened on the platform recently?", "What is the highest package in the 2023 batch?",
              "How many students are placed so far?", "Which students did internships and at what stipend?"],
}


def _mine(db: Session, user: User, conversation_id: int) -> AssistantConversation:
    conversation = db.query(AssistantConversation).filter(
        AssistantConversation.id == conversation_id, AssistantConversation.user_id == user.id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _message_out(m: AssistantMessage) -> dict:
    return {"id": m.id, "role": m.role, "content": m.content, "charts": json.loads(m.extra)["charts"] if m.extra else [],
            "created_at": str(m.created_at)[:16] if m.created_at else None}


@router.get("/starters")
def starters(user: User = Depends(get_current_user)):
    return {"starters": STARTERS.get(user.role, []), "available": assistant.is_configured()}


@router.get("/conversations")
def my_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(AssistantConversation).filter(AssistantConversation.user_id == user.id).order_by(
        AssistantConversation.updated_at.desc(), AssistantConversation.id.desc()).limit(50).all()
    return [{"id": c.id, "title": c.title, "updated_at": str(c.updated_at)[:16] if c.updated_at else None} for c in rows]


@router.get("/conversations/{conversation_id}")
def one_conversation(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = _mine(db, user, conversation_id)
    messages = db.query(AssistantMessage).filter(AssistantMessage.conversation_id == conversation.id).order_by(AssistantMessage.id).all()
    return {"id": conversation.id, "title": conversation.title, "messages": [_message_out(m) for m in messages]}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = _mine(db, user, conversation_id)
    db.query(AssistantMessage).filter(AssistantMessage.conversation_id == conversation.id).delete(synchronize_session=False)
    db.delete(conversation)
    db.commit()
    return {"message": "Deleted"}


class ChatIn(BaseModel):
    message: str
    conversation_id: Optional[int] = None


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
def chat(payload: ChatIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    text = (payload.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Type a question first")
    if len(text) > MAX_MESSAGE:
        raise HTTPException(status_code=400, detail=f"That message is too long ({MAX_MESSAGE} characters at most)")

    if payload.conversation_id:
        conversation = _mine(db, user, payload.conversation_id)
    else:
        conversation = AssistantConversation(user_id=user.id, title=text[:70])
        db.add(conversation)
        db.flush()
    db.add(AssistantMessage(conversation_id=conversation.id, role="user", content=text))
    db.commit()
    conversation_id = conversation.id
    history = [{"role": m.role, "content": m.content} for m in db.query(AssistantMessage).filter(
        AssistantMessage.conversation_id == conversation_id).order_by(AssistantMessage.id).all()]

    # The reply is produced after this function has returned, by which time the
    # request's own database session has been closed. The stream therefore
    # opens a session of its own and looks the user up again by id.
    bind, user_id = db.get_bind(), user.id

    def stream():
        session = Session(bind=bind)
        try:
            yield _event("start", {"conversation_id": conversation_id})
            me = session.query(User).filter(User.id == user_id).first()
            me.role = normalize_role(me.role)
            final = None
            for event in assistant.run_turn(session, me, history):
                if event["type"] == "done":
                    final = event
                else:
                    yield _event(event["type"], {k: v for k, v in event.items() if k != "type"})
            if final is not None:
                message = AssistantMessage(conversation_id=conversation_id, role="assistant", content=final["content"],
                                           extra=json.dumps({"charts": final["charts"]}) if final["charts"] else None)
                session.add(message)
                touched = session.query(AssistantConversation).filter(AssistantConversation.id == conversation_id).first()
                if touched:
                    from sqlalchemy.sql import func
                    touched.updated_at = func.now()
                session.commit()
                yield _event("done", {"message_id": message.id, "available": final["available"]})
        except Exception:
            # Never end the stream in silence: the page is waiting for an answer.
            session.rollback()
            yield _event("text", {"text": "Something went wrong while answering. Please try again."})
            yield _event("error", {"text": "The reply could not be completed."})
            yield _event("done", {"message_id": None, "available": True})
        finally:
            session.close()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
