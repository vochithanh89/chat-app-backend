import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import env from '#start/env'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import fs from 'node:fs'

class S3Service {
  private client: S3Client | null = null

  constructor() {
    const bucket = env.get('S3_BUCKET_NAME')
    const region = env.get('S3_REGION')
    const accessKeyId = env.get('S3_ACCESS_KEY_ID')
    const secretAccessKey = env.get('S3_SECRET_ACCESS_KEY')

    if (bucket && region && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      })
    } else {
      console.warn('S3_BUCKET_NAME, S3_REGION, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY is missing. S3 uploads will fail.')
    }
  }

  /**
   * Uploads a file to S3 and returns the public URL.
   * @param file The AdonisJS MultipartFile to upload.
   * @param folder The target folder in the bucket (e.g. 'avatars').
   * @param originalFileName The original file name to use as a base.
   */
  public async upload(file: MultipartFile, folder: string, originalFileName: string): Promise<string> {
    if (!this.client) {
      throw new Error('S3 is not configured in .env')
    }

    const bucket = env.get('S3_BUCKET_NAME')!
    const key = `${folder}/${Date.now()}_${originalFileName.replace(/\\s/g, '_')}`
    
    if (!file.tmpPath) {
       throw new Error('File temporary path not found')
    }

    const fileStream = fs.createReadStream(file.tmpPath)

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: file.headers['content-type'] || 'application/octet-stream',
    })

    await this.client.send(command)

    return `https://${bucket}.s3.${env.get('S3_REGION')}.amazonaws.com/${key}`
  }
}

export default new S3Service()
