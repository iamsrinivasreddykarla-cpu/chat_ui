import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'chat_ui';
  readonly messages = signal<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Hi! I am connected to your local Qwen model. What would you like to explore?' }
  ]);
  readonly isSending = signal(false);
  readonly error = signal('');
  readonly modelOptions = ['qwen2.5:7b', 'gemma4:e2b'];
  selectedModel = 'qwen2.5:7b';
  draft = '';
  selectedFile: File | null = null;

  async sendMessage(): Promise<void> {
    const message = this.draft.trim();
    if ((!message && !this.selectedFile) || this.isSending()) return;
    const file = this.selectedFile;
    this.draft = '';
    this.selectedFile = null;
    this.error.set('');
    const userContent = file ? `${message || 'Analyze this file'}\n📎 ${file.name}` : message;
    this.messages.update(current => [...current, { role: 'user', content: userContent }, { role: 'assistant', content: '' }]);
    this.isSending.set(true);

    try {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('instruction', message || 'Summarize this document and list its main points.');
        const response = await fetch('http://localhost:8085/api/file-analysis', { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`File analysis returned HTTP ${response.status}`);
        const result = await response.json() as { response?: string };
        this.updateLastAssistant(result.response || 'The file was processed, but no response was returned.');
      } else {
        const response = await fetch('http://localhost:8085/api/stream', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, model: this.selectedModel })
        });
        if (!response.ok || !response.body) throw new Error(`Chat backend returned HTTP ${response.status}`);
        await this.readStream(response.body);
      }
    } catch (exception) {
      const detail = exception instanceof Error ? exception.message : 'Unknown error';
      this.error.set(`${detail}. Make sure chat_be is running on port 8085.`);
      this.updateLastAssistant('Unable to reach the chat backend.');
    } finally {
      this.isSending.set(false);
    }
  }

  clearChat(): void { this.messages.set([]); this.error.set(''); }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    if (this.selectedFile && !this.draft.trim()) this.draft = 'Summarize this file';
    input.value = '';
    this.error.set('');
  }

  removeFile(): void { this.selectedFile = null; }

  handleEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
      const content = event.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => {
          const data = line.substring(5);
          return data.startsWith(' ') ? data.substring(1) : data;
        })
        .join('\n');
        if (content === '[DONE]') return;
        if (content) this.updateLastAssistant(content);
      }
      if (done) break;
    }
  }

  private updateLastAssistant(content: string): void {
    this.messages.update(current => {
      const updated = [...current];
      const last = updated.length - 1;
      if (last >= 0 && updated[last].role === 'assistant') {
        updated[last] = { ...updated[last], content: updated[last].content + content };
      }
      return updated;
    });
  }
}
