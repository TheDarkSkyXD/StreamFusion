using System;
using System.IO;

sealed class CompletedResponseStream : Stream
{
    byte[] bytes;
    readonly int length;
    readonly Action<CompletedResponseStream> finished;
    int position;

    public CompletedResponseStream(byte[] bytes, int length, Action<CompletedResponseStream> finished)
    {
        this.bytes = bytes;
        this.length = length;
        this.finished = finished;
    }

    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return false; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { throw new NotSupportedException(); } }
    public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }

    public override int Read(byte[] buffer, int offset, int count)
    {
        lock (this)
        {
            if (bytes == null) return 0;
            var read = Math.Min(count, length - position);
            Array.Copy(bytes, position, buffer, offset, read);
            position += read;
            if (position == length) Release();
            return read;
        }
    }

    public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    public override void Flush() { }

    protected override void Dispose(bool disposing)
    {
        if (disposing) lock (this) Release();
        base.Dispose(disposing);
    }

    void Release()
    {
        if (bytes == null) return;
        bytes = null;
        finished(this);
    }
}
