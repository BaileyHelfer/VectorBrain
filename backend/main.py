import os
import json
import asyncio
from typing import List, Optional
from pathlib import Path
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

from langchain.docstore.document import Document
from langchain.chains import ConversationalRetrievalChain
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.llms import LlamaCpp
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory
from langchain.callbacks.base import BaseCallbackHandler
from langchain_community.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

app = FastAPI(title="RAG Chat API", version="1.0.0")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Configuration ===
UPLOAD_DIR = Path("uploads")
KNOWLEDGE_DIR = Path("knowledge")
MODEL_PATH = "models/mistral-7b-instruct-v0.1.Q4_K_M.gguf"

# Create directories if they don't exist
UPLOAD_DIR.mkdir(exist_ok=True)
KNOWLEDGE_DIR.mkdir(exist_ok=True)

# === Global Variables ===
embedding_model = None
vectorstore = None
retriever = None
memory = None

# === Models ===
class ChatMessage(BaseModel):
    message: str

class DocumentInfo(BaseModel):
    filename: str
    size: int
    type: str

# === WebSocket Streaming Handler ===
class WebSocketStreamHandler(BaseCallbackHandler):
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.text = ""

    async def on_llm_new_token(self, token: str, **kwargs):
        self.text += token
        try:
            await self.websocket.send_text(json.dumps({
                "type": "token",
                "data": token
            }))
        except Exception as e:
            print(f"Error sending token: {e}")

# === Document Processing Functions ===
def load_csv_to_docs(csv_path: str) -> List[Document]:
    """Convert CSV to Langchain Documents"""
    df = pd.read_csv(csv_path)
    df.dropna(how="all", inplace=True)
    df.columns = [str(c).strip() for c in df.columns]

    docs = []
    for _, row in df.iterrows():
        content_lines = [f"{col}: {val}" for col, val in row.items() if pd.notnull(val)]
        content = "\n".join(content_lines)
        docs.append(Document(page_content=content, metadata={"source": csv_path}))
    return docs

def load_text_to_docs(text_path: str) -> List[Document]:
    """Load and split text files"""
    loader = TextLoader(text_path, encoding="utf-8")
    docs_raw = loader.load()
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    return splitter.split_documents(docs_raw)

def rebuild_vectorstore():
    """Rebuild the vector store from all uploaded documents"""
    global vectorstore, retriever
    
    all_docs = []
    
    # Load all CSV files
    for csv_file in UPLOAD_DIR.glob("*.csv"):
        try:
            docs = load_csv_to_docs(str(csv_file))
            all_docs.extend(docs)
        except Exception as e:
            print(f"Error loading CSV {csv_file}: {e}")
    
    # Load all text files
    for txt_file in UPLOAD_DIR.glob("*.txt"):
        try:
            docs = load_text_to_docs(str(txt_file))
            all_docs.extend(docs)
        except Exception as e:
            print(f"Error loading text file {txt_file}: {e}")
    
    # Load knowledge base files
    for txt_file in KNOWLEDGE_DIR.glob("*.txt"):
        try:
            docs = load_text_to_docs(str(txt_file))
            all_docs.extend(docs)
        except Exception as e:
            print(f"Error loading knowledge file {txt_file}: {e}")
    
    if all_docs:
        vectorstore = FAISS.from_documents(all_docs, embedding_model)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
        print(f"Vector store rebuilt with {len(all_docs)} documents")
    else:
        print("No documents found to build vector store")

# === Startup Event ===
@app.on_event("startup")
async def startup_event():
    global embedding_model, memory
    
    print("Initializing embedding model...")
    embedding_model = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
    
    print("Initializing conversation memory...")
    memory = ConversationBufferMemory(
        memory_key="chat_history",
        return_messages=True
    )
    
    print("Building initial vector store...")
    rebuild_vectorstore()
    
    print("Startup complete!")

# === API Endpoints ===
@app.get("/")
async def root():
    return {"message": "RAG Chat API is running"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "vectorstore_ready": vectorstore is not None,
        "documents_count": len(list(UPLOAD_DIR.glob("*.*"))) if UPLOAD_DIR.exists() else 0
    }

@app.post("/upload")
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload a document (CSV or TXT)"""
    if not file.filename.lower().endswith(('.csv', '.txt')):
        raise HTTPException(status_code=400, detail="Only CSV and TXT files are supported")
    
    file_path = UPLOAD_DIR / file.filename
    
    # Save file
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    # Rebuild vector store in background
    background_tasks.add_task(rebuild_vectorstore)
    
    return {
        "filename": file.filename,
        "size": len(content),
        "message": "File uploaded successfully"
    }

@app.get("/documents", response_model=List[DocumentInfo])
async def list_documents():
    """List all uploaded documents"""
    documents = []
    
    for file_path in UPLOAD_DIR.glob("*.*"):
        if file_path.is_file():
            stat = file_path.stat()
            documents.append(DocumentInfo(
                filename=file_path.name,
                size=stat.st_size,
                type=file_path.suffix[1:]  # Remove the dot
            ))
    
    return documents

@app.delete("/documents/{filename}")
async def delete_document(filename: str, background_tasks: BackgroundTasks):
    """Delete a document"""
    file_path = UPLOAD_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    file_path.unlink()
    
    # Rebuild vector store in background
    background_tasks.add_task(rebuild_vectorstore)
    
    return {"message": f"File {filename} deleted successfully"}

@app.post("/chat/clear")
async def clear_chat_history():
    """Clear conversation history"""
    global memory
    memory = ConversationBufferMemory(
        memory_key="chat_history",
        return_messages=True
    )
    return {"message": "Chat history cleared"}

# === WebSocket Chat Endpoint ===
@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message_data = json.loads(data)
            question = message_data.get("message", "").strip()
            
            if not question:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "data": "Empty message received"
                }))
                continue
            
            if not retriever:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "data": "No documents uploaded. Please upload some documents first."
                }))
                continue
            
            # Send start signal
            await websocket.send_text(json.dumps({
                "type": "start",
                "data": "Processing your question..."
            }))
            
            try:
                # Create streaming handler
                stream_handler = WebSocketStreamHandler(websocket)
                
                # Initialize LLM with streaming
                llm = LlamaCpp(
                    model_path=MODEL_PATH,
                    temperature=0,
                    max_tokens=512,
                    n_gpu_layers=999,
                    n_batch=128,
                    echo=False,
                    n_ctx= 32768,
                    f16_kv=True,
                    streaming=True,
                    callbacks=[stream_handler],
                    verbose=False,
                )
                
                # Create QA chain
                qa_chain = ConversationalRetrievalChain.from_llm(
                    llm=llm,
                    retriever=retriever,
                    memory=memory,
                    verbose=False,
                )
                
                # Process question (this will stream tokens via the callback)
                result = qa_chain.invoke({"question": question})
                
                # Send completion signal
                await websocket.send_text(json.dumps({
                    "type": "complete",
                    "data": "Response complete"
                }))
                
            except Exception as e:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "data": f"Error processing question: {str(e)}"
                }))
                
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)