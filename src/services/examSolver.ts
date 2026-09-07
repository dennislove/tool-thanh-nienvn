import { XMLParser } from 'fast-xml-parser';

export interface UiNode {
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  bounds: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerX: number;
    centerY: number;
  };
}

export interface AnswerItem {
  question: string;
  options: string[];
  answer: string;
}

export interface DetectedAnswerMatch {
  questionMatched: string;
  screenQuestionText: string;
  targetAnswer: string;
  targetNode: UiNode;
  confidence: number;
  optionIndex?: number;
}

/**
 * Chuẩn hóa chuỗi tiếng Việt và loại bỏ ký tự đặc biệt, khoảng trắng thừa
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFC')
    .toLowerCase()
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/[.,:;?!–—\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Loại bỏ toàn bộ tiền tố câu hỏi (Câu 1:, Câu hỏi 1:, Câu 01/20:, 1/20:, 1., ...)
 */
export function cleanQuestionText(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^(câu\s*hỏi\s*(số)?|câu|cau)\s*\d+(\s*\/\s*\d+)?[\s:.)/-]*/i, '');
  cleaned = cleaned.replace(/^\d+\s*\/\s*\d+[\s:.)/-]*/, '');
  cleaned = cleaned.replace(/^\d+[\s:.)/-]+/, '');
  return normalizeText(cleaned);
}

/**
 * Loại bỏ tiền tố phương án như "A. ", "B) ", "[A] ", "(A) ", "A - ", "1. "
 */
export function cleanOptionText(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^[\(\[]?([a-dA-D]|[1-4])[\)\]]?[\s.:-]+\s*/, '');
  return normalizeText(cleaned);
}

/**
 * Tính toán độ tương đồng giữa 2 chuỗi (kết hợp Dice Bigram và chứa chuỗi con)
 */
export function calculateTextSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeText(str1);
  const norm2 = normalizeText(str2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  // Nếu chuỗi này nằm trọn vẹn trong chuỗi kia
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const minLen = Math.min(norm1.length, norm2.length);
    const maxLen = Math.max(norm1.length, norm2.length);
    return 0.88 + 0.12 * (minLen / maxLen);
  }

  // Bigram similarity (Sørensen–Dice)
  const bg1: string[] = [];
  for (let i = 0; i < norm1.length - 1; i++) {
    bg1.push(norm1.slice(i, i + 2));
  }
  const bg2: string[] = [];
  for (let i = 0; i < norm2.length - 1; i++) {
    bg2.push(norm2.slice(i, i + 2));
  }
  if (bg1.length === 0 || bg2.length === 0) return 0;

  let matches = 0;
  const bg2Copy = [...bg2];
  for (const b of bg1) {
    const idx = bg2Copy.indexOf(b);
    if (idx !== -1) {
      matches++;
      bg2Copy.splice(idx, 1);
    }
  }

  return (2 * matches) / (bg1.length + bg2.length);
}

/**
 * Phân tích chuỗi bounds [x1,y1][x2,y2] từ UIAutomator XML
 */
export function parseBounds(boundsStr: string): UiNode['bounds'] | null {
  if (!boundsStr) return null;
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const x1 = parseInt(match[1], 10);
  const y1 = parseInt(match[2], 10);
  const x2 = parseInt(match[3], 10);
  const y2 = parseInt(match[4], 10);
  return {
    x1,
    y1,
    x2,
    y2,
    centerX: Math.round((x1 + x2) / 2),
    centerY: Math.round((y1 + y2) / 2),
  };
}

/**
 * Trích xuất toàn bộ danh sách các node có text/content-desc từ XML của UIAutomator
 */
export function parseUiHierarchy(xmlString: string): UiNode[] {
  if (!xmlString || !xmlString.includes('<hierarchy')) return [];

  // Làm sạch XML nếu có text thừa sau thẻ đóng </hierarchy>
  let cleanXml = xmlString;
  const endIdx = cleanXml.indexOf('</hierarchy>');
  if (endIdx !== -1) {
    cleanXml = cleanXml.substring(0, endIdx + 12);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
  });

  let parsed: any;
  try {
    parsed = parser.parse(cleanXml);
  } catch {
    return [];
  }

  const nodes: UiNode[] = [];

  function walk(nodeObj: any) {
    if (!nodeObj || typeof nodeObj !== 'object') return;

    if (nodeObj['@_bounds']) {
      const text = (nodeObj['@_text'] || '').toString().trim();
      const contentDesc = (nodeObj['@_content-desc'] || '').toString().trim();
      const resourceId = (nodeObj['@_resource-id'] || '').toString().trim();
      const className = (nodeObj['@_class'] || '').toString().trim();
      const bounds = parseBounds(nodeObj['@_bounds']);

      if (bounds && (text.length > 0 || contentDesc.length > 0)) {
        nodes.push({
          text,
          contentDesc,
          resourceId,
          className,
          bounds,
        });
      }
    }

    // Duyệt tiếp các node con
    for (const key of Object.keys(nodeObj)) {
      if (key === 'node') {
        const children = Array.isArray(nodeObj.node) ? nodeObj.node : [nodeObj.node];
        for (const child of children) {
          walk(child);
        }
      } else if (typeof nodeObj[key] === 'object' && nodeObj[key] !== null) {
        walk(nodeObj[key]);
      }
    }
  }

  walk(parsed);
  return nodes;
}

/**
 * Tìm kiếm câu hỏi và đáp án đúng trên màn hình hiện tại
 */
export function solveQuestionFromNodes(
  nodes: UiNode[],
  answersBank: AnswerItem[]
): DetectedAnswerMatch | null {
  if (nodes.length === 0 || answersBank.length === 0) return null;

  // Lọc các node có nội dung hiển thị
  const textNodes = nodes.filter((n) => {
    const raw = (n.text || n.contentDesc || '').trim();
    return raw.length > 0;
  });

  // Tìm node câu hỏi khớp nhất từ answersBank
  let bestQuestionScore = 0;
  let matchedBankItem: AnswerItem | null = null;
  let matchedQuestionNode: UiNode | null = null;

  for (const node of textNodes) {
    const rawText = (node.text || node.contentDesc || '').trim();
    const cleanScreen = cleanQuestionText(rawText);

    if (cleanScreen.length < 5) continue;

    for (const item of answersBank) {
      const cleanBank = cleanQuestionText(item.question);
      const score = calculateTextSimilarity(cleanScreen, cleanBank);

      if (score > bestQuestionScore) {
        bestQuestionScore = score;
        matchedBankItem = item;
        matchedQuestionNode = node;
      }
    }
  }

  // Nếu không tìm thấy câu hỏi với độ tin cậy đủ cao (>= 0.50)
  if (!matchedBankItem || !matchedQuestionNode || bestQuestionScore < 0.5) {
    return null;
  }

  const targetAnswerRaw = matchedBankItem.answer;
  const cleanTargetAnswer = normalizeText(targetAnswerRaw);

  // Tìm trong các node ứng viên cho đáp án (nằm dưới vị trí câu hỏi)
  let bestOptionScore = 0;
  let targetOptionNode: UiNode | null = null;

  const candidateOptionNodes = textNodes.filter(
    (n) => n !== matchedQuestionNode && n.bounds.centerY >= (matchedQuestionNode?.bounds.y1 || 0)
  );

  for (const node of candidateOptionNodes) {
    const rawText = (node.text || node.contentDesc || '').trim();
    const cleanOpt = cleanOptionText(rawText);

    if (!cleanOpt) continue;

    let score = calculateTextSimilarity(cleanOpt, cleanTargetAnswer);

    // Khớp chính xác hoặc chứa trọn vẹn chuỗi đáp án
    if (cleanOpt === cleanTargetAnswer) {
      score = 1.0;
    } else if (cleanOpt.includes(cleanTargetAnswer) || cleanTargetAnswer.includes(cleanOpt)) {
      score = Math.max(score, 0.95);
    }

    if (score > bestOptionScore) {
      bestOptionScore = score;
      targetOptionNode = node;
    }
  }

  if (targetOptionNode && bestOptionScore >= 0.5) {
    return {
      questionMatched: matchedBankItem.question,
      screenQuestionText: matchedQuestionNode.text || matchedQuestionNode.contentDesc,
      targetAnswer: targetAnswerRaw,
      targetNode: targetOptionNode,
      confidence: (bestQuestionScore + bestOptionScore) / 2,
    };
  }

  return null;
}
