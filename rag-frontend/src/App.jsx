import React, { useState, useEffect, useRef } from 'react';
import { Upload, Send, Trash2, File, MessageCircle, X, RefreshCw } from 'lucide-react';
import { 
  Button, 
  Input, 
  Card, 
  Badge, 
  Upload as AntUpload, 
  List, 
  Typography, 
  Space, 
  Tabs, 
  message as antMessage,
  Divider,
  Avatar,
  Tooltip
} from 'antd';
import { 
  MessageOutlined, 
  FileTextOutlined, 
  UploadOutlined, 
  DeleteOutlined, 
  ReloadOutlined,
  ClearOutlined,
  SendOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons';

const { TextArea } = Input;
const { Title, Paragraph, Text } = Typography;
const { TabPane } = Tabs;

const App = () => {
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  
  const websocketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const currentResponseRef = useRef('');

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();
    fetchDocuments();
    
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const connectWebSocket = () => {
    try {
      websocketRef.current = new WebSocket('ws://localhost:8000/ws/chat');
      
      websocketRef.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };
      
      websocketRef.current.onclose = () => {
        setIsConnected(false);
        setIsStreaming(false);
        console.log('WebSocket disconnected');
      };
      
      websocketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
      
      websocketRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'start':
            setIsStreaming(true);
            currentResponseRef.current = '';
            setMessages(prev => [...prev, { type: 'assistant', content: '', isStreaming: true }]);
            break;
            
          case 'token':
            currentResponseRef.current += data.data;
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.type === 'assistant' && lastMessage.isStreaming) {
                lastMessage.content = currentResponseRef.current;
              }
              return newMessages;
            });
            break;
            
          case 'complete':
            setIsStreaming(false);
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.type === 'assistant') {
                lastMessage.isStreaming = false;
              }
              return newMessages;
            });
            break;
            
          case 'error':
            setIsStreaming(false);
            setMessages(prev => [...prev, { type: 'error', content: data.data }]);
            antMessage.error('Error occurred while processing your message');
            break;
        }
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setIsConnected(false);
      antMessage.error('Failed to connect to server');
    }
  };

  const sendMessage = () => {
    if (!currentMessage.trim() || !isConnected || isStreaming) return;
    
    // Add user message
    setMessages(prev => [...prev, { type: 'user', content: currentMessage }]);
    
    // Send to WebSocket
    websocketRef.current.send(JSON.stringify({ message: currentMessage }));
    
    setCurrentMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const fetchDocuments = async () => {
    try {
      const response = await fetch('http://localhost:8000/documents');
      const docs = await response.json();
      setDocuments(docs);
    } catch (error) {
      console.error('Error fetching documents:', error);
      antMessage.error('Failed to fetch documents');
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadProgress({ filename: file.name, status: 'uploading' });
    antMessage.loading({ content: `Uploading ${file.name}...`, key: 'upload' });

    try {
      const response = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setUploadProgress({ filename: file.name, status: 'success' });
        await fetchDocuments();
        antMessage.success({ content: 'File uploaded successfully!', key: 'upload', duration: 2 });
        setTimeout(() => setUploadProgress(null), 3000);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      setUploadProgress({ filename: file.name, status: 'error' });
      antMessage.error({ content: 'Upload failed!', key: 'upload', duration: 2 });
      setTimeout(() => setUploadProgress(null), 3000);
      console.error('Error uploading file:', error);
    }

    event.target.value = '';
  };

  const deleteDocument = async (filename) => {
    try {
      const response = await fetch(`http://localhost:8000/documents/${filename}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchDocuments();
        antMessage.success('Document deleted successfully');
      } else {
        console.error('Error deleting document');
        antMessage.error('Failed to delete document');
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      antMessage.error('Failed to delete document');
    }
  };

  const clearChat = async () => {
    try {
      await fetch('http://localhost:8000/chat/clear', { method: 'POST' });
      setMessages([]);
      antMessage.success('Chat cleared successfully');
    } catch (error) {
      console.error('Error clearing chat:', error);
      antMessage.error('Failed to clear chat');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const chatContent = (
    <Card 
      className="h-full"
      bodyStyle={{ padding: 0, height: '100%' }}
    >
      {/* Chat Header */}
      <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50">
        <Space>
          <MessageOutlined className="text-orange-600" />
          <Text strong className="text-gray-800">Chat Assistant</Text>
          <Badge 
            status={isConnected ? "processing" : "error"} 
            text={isConnected ? "Connected" : "Disconnected"} 
          />
        </Space>
        <Button 
          type="primary" 
          danger 
          size="small"
          icon={<ClearOutlined />}
          onClick={clearChat}
        >
          Clear
        </Button>
      </div>

      {/* Messages */}
      <div className="h-96 overflow-y-auto p-4 bg-gradient-to-br from-orange-25 to-amber-25">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <RobotOutlined className="text-4xl mb-4 text-orange-400" />
            <Paragraph className="text-gray-600">
              Start a conversation by typing a message below
            </Paragraph>
            <Text type="secondary">Make sure you have uploaded some documents first!</Text>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className="flex items-start space-x-2 max-w-lg">
                {message.type === 'assistant' && (
                  <Avatar 
                    size="small" 
                    icon={<RobotOutlined />} 
                    className="bg-orange-500 flex-shrink-0 mt-1" 
                  />
                )}
                <Card
                  size="small"
                  className={`${
                    message.type === 'user'
                      ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white border-orange-400'
                      : message.type === 'error'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-orange-200 shadow-sm'
                  }`}
                  bodyStyle={{ padding: '8px 12px' }}
                >
                  <div className="whitespace-pre-wrap text-sm">
                    {message.content}
                    {message.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-orange-400 ml-1 animate-pulse rounded"></span>
                    )}
                  </div>
                </Card>
                {message.type === 'user' && (
                  <Avatar 
                    size="small" 
                    icon={<UserOutlined />} 
                    className="bg-blue-500 flex-shrink-0 mt-1" 
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-white">
        <Space.Compact className="w-full">
          <TextArea
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onPressEnter={handleKeyPress}
            placeholder="Ask me anything about your documents..."
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={!isConnected || isStreaming}
            className="flex-1"
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={sendMessage}
            disabled={!isConnected || isStreaming || !currentMessage.trim()}
            className="bg-orange-500 hover:bg-orange-600 border-orange-500 hover:border-orange-600 h-full"
          >
            Send
          </Button>
        </Space.Compact>
      </div>
    </Card>
  );

  const documentsContent = (
    <Card className="h-full" bodyStyle={{ padding: 0 }}>
      {/* Documents Header */}
      <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50">
        <Space>
          <FileTextOutlined className="text-orange-600" />
          <Text strong className="text-gray-800">Documents</Text>
          <Badge count={documents.length} className="bg-orange-500" />
        </Space>
        <Space>
          <Button 
            icon={<ReloadOutlined />}
            onClick={fetchDocuments}
            size="small"
          >
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
            className="bg-green-600 hover:bg-green-700 border-green-600 hover:border-green-700"
            size="small"
          >
            Upload
          </Button>
        </Space>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Documents List */}
      <div className="p-4 bg-gradient-to-br from-orange-25 to-amber-25 min-h-96">
        {documents.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <FileTextOutlined className="text-4xl mb-4 text-orange-400" />
            <Paragraph className="text-gray-600">No documents uploaded</Paragraph>
            <Text type="secondary">Upload CSV or TXT files to get started</Text>
          </div>
        ) : (
          <List
            itemLayout="horizontal"
            dataSource={documents}
            renderItem={(doc, index) => (
              <List.Item
                key={index}
                actions={[
                  <Tooltip title="Delete document">
                    <Button 
                      type="text" 
                      danger 
                      icon={<DeleteOutlined />}
                      onClick={() => deleteDocument(doc.filename)}
                      size="small"
                    />
                  </Tooltip>
                ]}
                className="bg-white rounded-lg mb-2 border border-orange-100 hover:border-orange-300 transition-colors px-4"
              >
                <List.Item.Meta
                  avatar={<Avatar icon={<FileTextOutlined />} className="bg-orange-100 text-orange-600" />}
                  title={<Text strong className="text-gray-800">{doc.filename}</Text>}
                  description={
                    <Text type="secondary">
                      {doc.type.toUpperCase()} • {formatFileSize(doc.size)}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-100 via-amber-50 to-yellow-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <Title level={1} className="text-gray-800 mb-2">
            RAG Chat Assistant
          </Title>
          <Paragraph className="text-gray-600 text-lg">
            Conversational AI with Document Intelligence
          </Paragraph>
        </div>

        {/* Main Content */}
        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <Tabs 
            activeKey={activeTab} 
            onChange={setActiveTab}
            type="card"
            className="min-h-[500px]"
            items={[
              {
                key: 'chat',
                label: (
                  <Space>
                    <MessageOutlined />
                    Chat
                  </Space>
                ),
                children: chatContent
              },
              {
                key: 'documents',
                label: (
                  <Space>
                    <FileTextOutlined />
                    Documents
                    <Badge count={documents.length} size="small" />
                  </Space>
                ),
                children: documentsContent
              }
            ]}
          />
        </Card>
      </div>
    </div>
  );
};

export default App;