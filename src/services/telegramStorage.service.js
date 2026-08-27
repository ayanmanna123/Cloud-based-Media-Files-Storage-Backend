const { AppError, ERROR_CODES } = require('../utils/error');

class TelegramStorageService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
  }

  isConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
  }

  getBotToken() {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) {
      throw new AppError(
        'TELEGRAM_BOT_TOKEN is missing in environment configuration. Please check your backend .env file.',
        ERROR_CODES.INTERNAL_SERVER_ERROR.status,
        ERROR_CODES.INTERNAL_SERVER_ERROR.code
      );
    }
    return token;
  }

  getChatId() {
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!chatId) {
      throw new AppError(
        'TELEGRAM_CHAT_ID is missing in environment configuration. Please check your backend .env file.',
        ERROR_CODES.INTERNAL_SERVER_ERROR.status,
        ERROR_CODES.INTERNAL_SERVER_ERROR.code
      );
    }
    return chatId;
  }


  /**
   * Upload a file buffer to Telegram channel using sendDocument API
   * @param {Buffer} buffer - File content buffer
   * @param {string} fileName - File name
   * @param {string} mimeType - MIME type of file
   * @returns {Promise<{ fileId: string, fileUniqueId: string, messageId: number }>}
   */
  async uploadFile(buffer, fileName, mimeType) {
    const token = this.getBotToken();
    const chatId = this.getChatId();

    const formData = new FormData();
    formData.append('chat_id', chatId);

    // Create a Blob from buffer for standard fetch FormData compatibility
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    formData.append('document', blob, fileName || 'file');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram sendDocument error:', data);
      throw new AppError(
        `Telegram upload failed: ${data.description || 'Unknown error'}`,
        ERROR_CODES.INTERNAL_SERVER_ERROR.status,
        ERROR_CODES.INTERNAL_SERVER_ERROR.code
      );
    }

    const result = data.result;
    const doc = result.document || result.audio || result.video || result.photo?.[result.photo.length - 1];

    if (!doc) {
      throw new AppError(
        'Telegram upload response did not include file document object',
        ERROR_CODES.INTERNAL_SERVER_ERROR.status,
        ERROR_CODES.INTERNAL_SERVER_ERROR.code
      );
    }

    return {
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      messageId: result.message_id,
    };
  }

  /**
   * Resolve direct temporary URL for file on Telegram
   * @param {string} fileId - Telegram file_id
   * @returns {Promise<string>} Direct file URL
   */
  async getFileUrl(fileId) {
    const token = this.getBotToken();

    const response = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram getFile error:', data);
      throw new AppError(
        `Failed to retrieve file from Telegram: ${data.description || 'File not found'}`,
        ERROR_CODES.NOT_FOUND.status,
        ERROR_CODES.NOT_FOUND.code
      );
    }

    const filePath = data.result.file_path;
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }

  /**
   * Delete message containing file from Telegram channel
   * @param {number|string} messageId - Telegram message_id
   */
  async deleteMessage(messageId) {
    if (!messageId) return;
    try {
      const token = this.getBotToken();
      const chatId = this.getChatId();

      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
        }),
      });
    } catch (err) {
      console.error('Failed to delete Telegram message:', err);
    }
  }
}

module.exports = new TelegramStorageService();
