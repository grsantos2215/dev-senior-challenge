import {
    RequestAgendamentos200Dto,
    RequestAgendamentos500Dto,
} from '../infra/http/dtos/request-agendamentos'

import { JsonObject } from '../generated/prisma/internal/prismaNamespace'

type XmlConverter = RequestAgendamentos200Dto | RequestAgendamentos500Dto

export function convertXmlToJson(xmlString: string): XmlConverter {
    const cleanXml = xmlString
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .trim()

    function parse(xmlText: string): any {
        const tagRegex = /<([\w:.-]+)>([\s\S]*?)<\/\1>/g

        const obj: JsonObject = {}
        let hasChildren = false
        let match

        while ((match = tagRegex.exec(xmlText)) !== null) {
            hasChildren = true
            const tagName = match[1]
            const tagContent = match[2]

            const parsedValue = parse(tagContent)

            if (obj[tagName] !== undefined) {
                if (!Array.isArray(obj[tagName])) {
                    obj[tagName] = [obj[tagName]]
                }
                obj[tagName].push(parsedValue)
            } else {
                if (parsedValue === 'true') obj[tagName] = true
                else if (parsedValue === 'false') obj[tagName] = false
                else obj[tagName] = parsedValue
            }
        }

        if (!hasChildren) {
            return xmlText
        }

        return obj
    }

    return parse(cleanXml)
}
