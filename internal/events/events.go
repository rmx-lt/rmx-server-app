// Package events is a generic in-process publish/subscribe bus. Publishing
// never blocks: a subscriber that falls behind by more than its buffer is
// dropped (its channel closes and Lagged reports true) and has to resync
// from the database. Events are published after the transaction that caused
// them has committed; state that must survive (like a command's ack) lives in
// the database, not here.
package events

import "sync"

// DefaultBuffer is the per-subscriber buffer of a New bus.
const DefaultBuffer = 256

// Bus broadcasts every published event to all subscribers.
type Bus[T any] struct {
	buffer int

	mu   sync.Mutex
	subs map[*Subscription[T]]struct{}
}

// New returns a bus with DefaultBuffer events per subscriber.
func New[T any]() *Bus[T] { return NewWithBuffer[T](DefaultBuffer) }

// NewWithBuffer returns a bus with buffer events per subscriber.
func NewWithBuffer[T any](buffer int) *Bus[T] {
	return &Bus[T]{buffer: buffer, subs: map[*Subscription[T]]struct{}{}}
}

// Subscription receives the events published after Subscribe.
type Subscription[T any] struct {
	// C delivers events in order. It is closed when the subscription ends: after
	// Close, or when the subscriber was too slow (then Lagged is true). Events
	// already buffered are still delivered before the close shows.
	C <-chan T

	ch     chan T
	bus    *Bus[T]
	lagged bool // protected by bus.mu
}

// Subscribe starts receiving events.
func (b *Bus[T]) Subscribe() *Subscription[T] {
	ch := make(chan T, b.buffer)
	s := &Subscription[T]{C: ch, ch: ch, bus: b}
	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()
	return s
}

// Close ends the subscription. It is safe to call more than once.
func (s *Subscription[T]) Close() {
	s.bus.mu.Lock()
	defer s.bus.mu.Unlock()
	if _, ok := s.bus.subs[s]; ok {
		delete(s.bus.subs, s)
		close(s.ch)
	}
}

// Lagged reports whether the subscription ended because the subscriber missed
// events. Call it after C is closed.
func (s *Subscription[T]) Lagged() bool {
	s.bus.mu.Lock()
	defer s.bus.mu.Unlock()
	return s.lagged
}

// Publish never blocks: a subscriber with a full buffer is dropped.
func (b *Bus[T]) Publish(e T) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for s := range b.subs {
		select {
		case s.ch <- e:
		default:
			s.lagged = true
			delete(b.subs, s)
			close(s.ch)
		}
	}
}
