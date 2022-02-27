import { readFileSync } from 'fs'
import { keyIn, keyInYN } from 'readline-sync'

const MEMORY_SIZE = 65536
const memory = new Uint16Array(MEMORY_SIZE)
type Uint16 = typeof memory[0]

enum Register {
  R_R0,
  R_R1,
  R_R2,
  R_R3,
  R_R4,
  R_R5,
  R_R6,
  R_R7,
  R_PC, /* program counter */
  R_COND,
  R_COUNT,
}
const registers = new Uint16Array(Register.R_COUNT)

enum OpCode {
  OP_BR = 0, /* branch */
  OP_ADD, /* add  */
  OP_LD, /* load */
  OP_ST, /* store */
  OP_JSR, /* jump register */
  OP_AND, /* bitwise and */
  OP_LDR, /* load register */
  OP_STR, /* store register */
  OP_RTI, /* unused */
  OP_NOT, /* bitwise not */
  OP_LDI, /* load indirect */
  OP_STI, /* store indirect */
  OP_JMP, /* jump */
  OP_RES, /* reserved (unused) */
  OP_LEA, /* load effective address */
  OP_TRAP/* execute trap */
}

enum Flag {
  FL_POS = 1 << 0, /* P */
  FL_ZRO = 1 << 1, /* Z */
  FL_NEG = 1 << 2, /* N */
}

/** Memory Mapped Registers */
enum MMR {
  MR_KBSR = 0xFE00, /* keyboard status */
  MR_KBDR = 0xFE02  /* keyboard data */
}

enum Trap {
  TRAP_GETC = 0x20,  /* get character from keyboard, not echoed onto the terminal */
  TRAP_OUT = 0x21,   /* output a character */
  TRAP_PUTS = 0x22,  /* output a word string */
  TRAP_IN = 0x23,    /* get character from keyboard, echoed onto the terminal */
  TRAP_PUTSP = 0x24, /* output a byte string */
  TRAP_HALT = 0x25   /* halt the program */
}

/**
 * set the PC to starting position
 * 0x3000 is the default
 */
const PC_START = 0x3000
registers[Register.R_PC] = PC_START

const SIGN_BIT = 1 << 15

let running = 1

function main() {
  readImage('./temp/2048.obj')

  while (running) {
    /* FETCH */
    const instr: Uint16 = memRead(registers[Register.R_PC])
    registers[Register.R_PC]++
    const op: Uint16 = instr >> 12

    switch (op) {
    case OpCode.OP_ADD: {
      add(instr)
      break
    }
    case OpCode.OP_AND: {
      bitwiseAnd(instr)
      break
    }
    case OpCode.OP_NOT: {
      bitwiseNot(instr)
      break
    }
    case OpCode.OP_BR: {
      branch(instr)
      break
    }
    case OpCode.OP_JMP: {
      jump(instr)
      break
    }
    case OpCode.OP_JSR: {
      jumpRegister(instr)
      break
    }
    case OpCode.OP_LD: {
      load(instr)
      break
    }
    case OpCode.OP_LDI: {
      loadIndirect(instr)
      break
    }
    case OpCode.OP_LDR: {
      loadRegister(instr)
      break
    }
    case OpCode.OP_LEA: {
      loadEffectiveAddress(instr)
      break
    }
    case OpCode.OP_ST: {
      store(instr)
      break
    }
    case OpCode.OP_STI: {
      storeIndirect(instr)
      break
    }
    case OpCode.OP_STR: {
      storeRegister(instr)
      break
    }
    case OpCode.OP_TRAP: {
      trapHandler(instr)
      break
    }
    case OpCode.OP_RES:
    case OpCode.OP_RTI:
    default: {
      abort()
    }
    }
  }
}

main()

function signExtend(x: Uint16, bitCount: number): Uint16 {
  const m = 1 << (bitCount - 1)
  x &= (1 << bitCount) - 1
  return (x ^ m) - m
}

function updateFlags(r: Uint16) {
  if (registers[r] === 0) {
    registers[Register.R_COND] = Flag.FL_ZRO
  } else if (registers[r] & SIGN_BIT) {
    /* a 1 in the left-most bit indicates negative */
    registers[Register.R_COND] = Flag.FL_NEG
  } else {
    registers[Register.R_COND] = Flag.FL_POS
  }
}

function add(instr: Uint16) {
  /* destination register (DR) */
  const r0: Uint16 = (instr >> 9) & 0x7
  /* first operand (SR1) */
  const r1: Uint16 = (instr >> 6) & 0x7
  /* whether we are in immediate mode */
  const immFlag: Uint16 = (instr >> 5) & 0x1

  if (immFlag) {
    const imm5: Uint16 = signExtend(instr & 0x1F, 5)
    registers[r0] = registers[r1] + imm5
  } else {
    const r2: Uint16 = instr & 0x7
    registers[r0] = registers[r1] + registers[r2]
  }

  updateFlags(r0)
}

function loadIndirect(instr: Uint16) {
  /* destination register (DR) */
  const r0: Uint16 = (instr >> 9) & 0x7
  /* PCoffset 9*/
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)

  /* add pc_offset to the current PC, look at that memory location to get the final address */
  registers[r0] = memRead(memRead(registers[Register.R_PC] + pcOffset))
  updateFlags(r0)
}

function abort() {
  process.exit(-1)
}

function bitwiseAnd(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const immFlag: Uint16 = (instr >> 5) & 0x1

  if (immFlag) {
    const imm5: Uint16 = signExtend(instr & 0x1F, 5)
    registers[r0] = registers[r1] & imm5
  } else {
    const r2: Uint16 = instr & 0x7
    registers[r0] = registers[r1] & registers[r2]
  }
  updateFlags(r0)
}

function bitwiseNot(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7

  registers[r0] = ~registers[r1]
  updateFlags(r0)
}

function branch(instr: Uint16) {
  const pcOffset: Uint16 = signExtend((instr) & 0x1ff, 9)
  const condFlag: Uint16 = (instr >> 9) & 0x7
  if (condFlag & registers[Register.R_COND]) {
    registers[Register.R_PC] += pcOffset
  }
}

function jump(instr: Uint16) {
  /* Also handles RET */
  const r1: Uint16 = (instr >> 6) & 0x7
  registers[Register.R_PC] = registers[r1]
}

function jumpRegister(instr: Uint16) {
  const r1: Uint16 = (instr >> 6) & 0x7
  const longPCOffset: Uint16 = signExtend(instr & 0x7ff, 11)
  const longFlag: Uint16 = (instr >> 11) & 1

  registers[Register.R_R7] = registers[Register.R_PC]
  if (longFlag) {
    registers[Register.R_PC] += longPCOffset  /* JSR */
  } else {
    registers[Register.R_PC] = registers[r1] /* JSRR */
  }
}

function load(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  registers[r0] = memRead(registers[Register.R_PC] + pcOffset)
  updateFlags(r0)
}

function loadRegister(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const offset: Uint16 = signExtend(instr & 0x3F, 6)
  registers[r0] = memRead(registers[r1] + offset)
  updateFlags(r0)
}

function loadEffectiveAddress(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  registers[r0] = registers[Register.R_PC] + pcOffset
  updateFlags(r0)
}

function store(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  memWrite(registers[Register.R_PC] + pcOffset, registers[r0])
}

function storeIndirect(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  memWrite(memRead(registers[Register.R_PC] + pcOffset), registers[r0])
}

function storeRegister(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const offset: Uint16 = signExtend(instr & 0x3F, 6)
  memWrite(registers[r1] + offset, registers[r0])
}

function putBuf(data: Uint16[]) {
  process.stdout.write(
    Buffer.from(data).toString('utf8')
  )
}

function trapHandler(instr: Uint16) {
  switch (instr & 0xFF) {
  case Trap.TRAP_GETC: {
    /* read a single ASCII char */
    registers[Register.R_R0] = getChar()
    break
  }
  case Trap.TRAP_OUT: {
    putBuf([registers[Register.R_R0]])
    break
  }
  case Trap.TRAP_PUTS: {
    /* one char per word */
    let addr: Uint16 = registers[Register.R_R0]
    const buf = []
    while (memory[addr] !== 0) {
      buf.push(memory[addr])
      addr++
    }
    putBuf(buf)
    break
  }
  case Trap.TRAP_IN: {
    console.log('Enter a character: ')
    registers[Register.R_R0] = getChar()
    break
  }
  case Trap.TRAP_PUTSP: {
    /* one char per byte (two bytes per word) here we need to swap back to
       big endian format */
    let addr: Uint16 = registers[Register.R_R0]
    const buf = []

    while (memory[addr] !== 0) {
      const char1 = memory[addr] & 0xFF
      buf.push(char1)

      const char2 = memory[addr] >> 8
      if (char2) {
        buf.push(char2)
      }
      addr++
    }
    putBuf(buf)
    break
  }
  case Trap.TRAP_HALT: {
    console.log('HALT')
    running = 0
  }
  }
}

function getChar(): Uint16 {
  const input = keyIn('').trim()
  if (input.toLowerCase() === 'q') {
    if (keyInYN('Would you like to quit ?')) {
      process.exit(0)
    }
  }
  return input.charCodeAt(0)
}

function memWrite(address: Uint16, val: Uint16) {
  memory[address] = val
}

function memRead(address: Uint16): Uint16 {
  if (address === MMR.MR_KBSR) {
    const input = getChar()
    if (input) {
      memory[MMR.MR_KBSR] = (1 << 15)
      memory[MMR.MR_KBDR] = input
    } else {
      memory[MMR.MR_KBSR] = 0x00
    }
  }
  return memory[address]
}

function readImage(imagePath: string) {
  const image = readFileSync(imagePath)
  /* the origin tells us where in memory to place the image */

  const origin: Uint16 = image.readUInt16BE(0)
  let pos = 0

  while ((pos + 1) * 2 < image.length) {
    memory[origin + pos] = image.readUInt16BE((pos + 1) * 2)
    pos++
  }
}
